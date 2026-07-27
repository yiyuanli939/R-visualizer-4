# R Visualizer — local execution backend.
#
# Runs the SAME trace engine (public/trace.R) on your desktop R installation,
# so any package your local R can load — CRAN, Bioconductor, or GitHub via
# devtools::install_github("kosukeimai/qss-package") — works unchanged.
#
# Usage (from the directory that holds your data files):
#   Rscript /path/to/repo/local-backend/serve.R [port]
#
# Requires: install.packages(c("httpuv", "jsonlite", "digest"))

## == repo-source-begin == (replaced by inlined trace.R in public/rviz-local.R)
args_all <- commandArgs(trailingOnly = FALSE)
file_arg <- sub("^--file=", "", grep("^--file=", args_all, value = TRUE)[1])
repo_root <- normalizePath(file.path(dirname(file_arg), ".."))
source(file.path(repo_root, "public", "trace.R"))
## == repo-source-end ==

if (!requireNamespace("httpuv", quietly = TRUE) ||
    !requireNamespace("jsonlite", quietly = TRUE)) {
  stop('Please run: install.packages(c("httpuv", "jsonlite"))')
}

cli_args <- commandArgs(trailingOnly = TRUE)
port <- {
  p <- suppressWarnings(as.integer(cli_args[!startsWith(cli_args, "--")][1]))
  if (is.na(p)) 8790L else p
}

## Security: this server evaluates R code. It binds to 127.0.0.1 only, and by
## default requires a per-session token so that arbitrary websites cannot
## drive it. Pass --no-token to disable (trusted machines only).
NO_TOKEN <- "--no-token" %in% cli_args
TOKEN <- Sys.getenv("RVIZ_TOKEN", "")
if (!NO_TOKEN && TOKEN == "") {
  TOKEN <- paste(sample(c(letters, LETTERS, 0:9), 24, replace = TRUE), collapse = "")
}
auth_ok <- function(req) NO_TOKEN || identical(req$HTTP_X_RVIZ_TOKEN, TOKEN)

PLOT_W <- 840 * 2
PLOT_H <- 580 * 2
PLOT_RES <- 144

cors <- list(
  "Access-Control-Allow-Origin" = "*",
  "Access-Control-Allow-Methods" = "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers" = "Content-Type, X-RViz-Token",
  # Chrome Private Network Access: allow public HTTPS pages to reach loopback
  "Access-Control-Allow-Private-Network" = "true",
  "Content-Type" = "application/json; charset=utf-8"
)

resp <- function(body, status = 200L) {
  list(status = status, headers = cors,
       body = if (is.character(body)) body else jsonlite::toJSON(body, auto_unbox = TRUE))
}

read_body <- function(req) {
  raw <- req$rook.input$read()
  if (!length(raw)) return(list())
  jsonlite::fromJSON(rawToChar(raw), simplifyVector = TRUE)
}

run_with_plots <- function(code, step_loops, stop_on_error, max_steps, fresh_env) {
  plot_dir <- file.path(tempdir(), paste0("rviz_plots_", as.integer(Sys.time())))
  dir.create(plot_dir, showWarnings = FALSE)
  grDevices::png(file.path(plot_dir, "p%03d.png"),
                 width = PLOT_W, height = PLOT_H, res = PLOT_RES)
  dev_id <- grDevices::dev.cur()
  json <- tryCatch(
    .tr_run(code, step_loops = step_loops, stop_on_error = stop_on_error,
            max_steps = max_steps, fresh_env = fresh_env),
    finally = {
      if (dev_id %in% grDevices::dev.list()) grDevices::dev.off(dev_id)
    }
  )
  files <- sort(list.files(plot_dir, pattern = "^p\\d+\\.png$", full.names = TRUE))
  plots <- vapply(files, function(f) {
    paste0("data:image/png;base64,", jsonlite::base64_enc(readBin(f, "raw", file.info(f)$size)))
  }, character(1), USE.NAMES = FALSE)
  unlink(plot_dir, recursive = TRUE)
  list(trace = json, plots = plots)
}

app <- list(
  call = function(req) {
    if (req$REQUEST_METHOD == "OPTIONS") return(resp("{}"))
    path <- req$PATH_INFO
    tryCatch({
      if (path == "/health") {
        if (!auth_ok(req)) {
          return(resp(list(ok = TRUE, authRequired = TRUE, engine = "local")))
        }
        return(resp(list(ok = TRUE, authRequired = FALSE,
                         r = as.character(getRversion()),
                         wd = getwd(), engine = "local")))
      }
      if (!auth_ok(req)) return(resp(list(error = "invalid token"), 401L))
      if (path == "/run") {
        b <- read_body(req)
        out <- run_with_plots(
          code = b$code,
          step_loops = isTRUE(b$stepLoops),
          stop_on_error = !isTRUE(b$continueOnError),
          max_steps = as.integer(b$maxSteps %||% 1000L),
          fresh_env = !isTRUE(b$keepWorkspace)
        )
        # trace is already a JSON string; splice it in verbatim
        return(resp(sprintf('{"trace":%s,"plots":%s}', out$trace,
                            jsonlite::toJSON(out$plots))))
      }
      if (path == "/page") {
        b <- read_body(req)
        return(resp(.tr_page(b$step, b$name, b$row0, b$nrows, b$col0, b$ncols)))
      }
      if (path == "/pipe_page") {
        b <- read_body(req)
        return(resp(.tr_pipe_page(b$storeId, b$row0, b$nrows, b$col0, b$ncols)))
      }
      if (path == "/inspect") {
        b <- read_body(req)
        return(resp(.tr_inspect_json(b$step, b$src,
                                     if (is.null(b$pipeStoreId)) NULL else b$pipeStoreId)))
      }
      if (path == "/fn_info") {
        b <- read_body(req)
        return(resp(.tr_fn_info_json(b$name)))
      }
      if (path == "/upload") {
        b <- read_body(req)
        safe <- gsub("\\\\", "/", b$name)
        parts <- Filter(function(p) nzchar(p) && p != "." && p != "..",
                        strsplit(safe, "/")[[1]])
        rel <- paste(parts, collapse = "/")
        if (length(parts) > 1)
          dir.create(dirname(rel), recursive = TRUE, showWarnings = FALSE)
        writeBin(jsonlite::base64_dec(b$data), rel)
        return(resp(list(ok = TRUE, name = rel)))
      }
      if (path == "/remove") {
        b <- read_body(req)
        unlink(b$name)
        return(resp(list(ok = TRUE)))
      }
      resp(list(error = "not found"), 404L)
    }, error = function(e) resp(list(error = conditionMessage(e)), 500L))
  }
)

`%||%` <- function(a, b) if (is.null(a)) b else a

cat(sprintf(paste0(
  "R Visualizer local backend\n",
  "  R %s · working directory: %s\n",
  "  listening on http://127.0.0.1:%d\n",
  "  (data files are read from / uploaded to this directory)\n%s"),
  getRversion(), getwd(), port,
  if (NO_TOKEN) "  token auth DISABLED (--no-token)\n"
  else sprintf("\n  In the app, switch the engine to \"Local R\" and paste this token:\n\n    %s\n\n", TOKEN)))
httpuv::runServer("127.0.0.1", port, app)
