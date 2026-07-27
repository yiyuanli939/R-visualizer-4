# Run from the repo root:  Rscript tests/stress-trace.R
source("public/trace.R")
`%||%` <- function(a, b) if (is.null(a)) b else a

run <- function(label, code, step_loops = TRUE) {
  t0 <- proc.time()[["elapsed"]]
  json <- tryCatch(.tr_run(code, step_loops), error = function(e) paste0("ENGINE-ERROR: ", conditionMessage(e)))
  dt <- round((proc.time()[["elapsed"]] - t0) * 1000)
  if (startsWith(json, "ENGINE-ERROR")) {
    cat(sprintf("[%s] %s (%d ms)\n", label, json, dt))
    return(invisible(NULL))
  }
  r <- jsonlite::fromJSON(json, simplifyVector = FALSE)
  errs <- Filter(function(s) !is.null(s$errorMsg), r$steps)
  cat(sprintf("[%s] ok=%s steps=%d plots=%d trunc=%s json=%.1fKB time=%dms%s\n",
              label, r$ok, length(r$steps), r$nPlots, r$truncated,
              nchar(json) / 1024, dt,
              if (length(errs)) paste0(" ERR@L", errs[[1]]$line1, ": ", substr(errs[[1]]$errorMsg, 1, 60)) else ""))
  invisible(r)
}

## T1: user code that itself uses capture.output / sink
run("user-capture", '
x <- capture.output(print(1:5))
x
sink(tempfile()); cat("hidden\n"); sink()
y <- "after sink"
')

## T2: user tryCatch + warning handling
run("user-trycatch", '
safe <- tryCatch(log(-1), warning = function(w) "caught warn")
safe2 <- tryCatch(stop("boom"), error = function(e) conditionMessage(e))
safe2
')

## T3: functions defined and called (incl. recursion, closures)
run("functions", '
make_counter <- function() { n <- 0; function() { n <<- n + 1; n } }
inc <- make_counter()
a <- inc(); b <- inc()
fact <- function(k) if (k <= 1) 1 else k * fact(k - 1)
f10 <- fact(10)
f10
')

## T4: apply family / purrr-style without loops
run("apply-family", '
res <- sapply(1:10, function(i) i^2)
lst <- lapply(1:3, function(i) data.frame(x = 1:i))
m <- vapply(lst, nrow, integer(1))
m
')

## T5: rm() and NULL-out
run("rm-null", '
a <- 1; b <- 2; c <- list(x = 1)
rm(b)
c$x <- NULL
a <- NULL
ls()
')

## T6: S4 + environment objects
run("s4-env", '
setClass("Point", representation(x = "numeric", y = "numeric"))
p <- new("Point", x = 1, y = 2)
e <- new.env(); assign("k", 42, envir = e)
p@x
')

## T7: list-columns and weird tibble-ish content
run("list-cols", '
df <- data.frame(id = 1:3)
df$payload <- list(1:5, letters, mtcars)
df$when <- as.Date("2020-01-01") + 0:2
df
')

## T8: error inside deep loop with folding active
run("error-in-folded-loop", '
s <- 0
for (i in 1:200) {
  s <- s + i
  if (i == 150) stop("dies at 150")
}
s
')

## T9: big object modified inside loop (fingerprint + env-store cost)
big_loop <- '
df <- data.frame(matrix(rnorm(5e5), ncol = 50))
for (i in 1:30) {
  df[[1]] <- df[[1]] * 1.01
}
nrow(df)
'
run("bigobj-loop", big_loop)

## T10: 600-statement flat script (large document)
stmts <- vapply(1:600, function(i) sprintf("v%03d <- %d * 2", i, i), character(1))
run("600-stmts", paste(stmts, collapse = "\n"))

## T11: 300-statement script each touching a shared df (snapshot churn)
stmts2 <- c("d <- data.frame(x = 1:100, y = rnorm(100))",
            vapply(1:300, function(i) sprintf("d$y[%d] <- %d", (i %% 100) + 1, i), character(1)))
run("300-df-mutations", paste(stmts2, collapse = "\n"))

## T12: long realistic analysis document (~350 lines, mixed everything)
doc <- paste(collapse = "\n", c(
  'set.seed(42)',
  'n <- 5000',
  'sales <- data.frame(',
  '  region = sample(c("North","South","East","West"), n, TRUE),',
  '  rep = sample(paste0("rep_", 1:40), n, TRUE),',
  '  units = rpois(n, 20),',
  '  price = round(runif(n, 5, 500), 2),',
  '  day = sample(seq(as.Date("2024-01-01"), by = "day", length.out = 365), n, TRUE)',
  ')',
  'sales$revenue <- sales$units * sales$price',
  'sales$month <- format(sales$day, "%Y-%m")',
  'monthly <- aggregate(revenue ~ month + region, data = sales, FUN = sum)',
  'monthly <- monthly[order(monthly$month), ]',
  'top_reps <- head(aggregate(revenue ~ rep, sales, sum), 10)',
  'clean <- subset(sales, units > 0 & price > 10)',
  'clean$log_rev <- log(clean$revenue)',
  'fit <- lm(log_rev ~ region + units, data = clean)',
  'coefs <- coef(summary(fit))',
  'preds <- predict(fit, newdata = clean[1:100, ])',
  'resid_sd <- sd(residuals(fit))',
  'qtiles <- quantile(clean$revenue, probs = seq(0, 1, 0.1))',
  'regions <- unique(sales$region)',
  'stats_by_region <- list()',
  'for (r in regions) {',
  '  sub <- sales[sales$region == r, ]',
  '  stats_by_region[[r]] <- c(mean = mean(sub$revenue), sd = sd(sub$revenue), n = nrow(sub))',
  '}',
  'summary_mat <- do.call(rbind, stats_by_region)',
  'normalize <- function(x) (x - min(x)) / (max(x) - min(x))',
  'sales$rev_norm <- normalize(sales$revenue)',
  'buckets <- cut(sales$rev_norm, breaks = 5, labels = paste0("Q", 1:5))',
  'tab <- table(buckets, sales$region)',
  'chi <- chisq.test(tab)',
  'pval <- chi$p.value',
  vapply(1:120, function(i) sprintf("check_%03d <- nrow(sales) > %d", i, i * 10), character(1)),
  'final_report <- list(monthly = head(monthly), top = top_reps, p = pval)',
  'str(final_report)'
))
cat("doc lines:", length(strsplit(doc, "\n")[[1]]), "\n")
run("analysis-document", doc)

## T13: 1e6-row data frame ops (paging source, fingerprints)
run("million-rows", '
huge <- data.frame(id = 1:1e6, val = rnorm(1e6), grp = sample(letters[1:5], 1e6, TRUE))
agg <- aggregate(val ~ grp, huge, mean)
huge$val2 <- huge$val * 2
agg
')

## T14: pipes nested inside function bodies (must NOT decompose)
run("pipe-in-function", '
f <- function(d) d |> subset(mpg > 20) |> nrow()
k <- f(mtcars)
k
')

## T15: user messes with options / warn level
run("user-options", '
options(warn = 1)
w <- sqrt(-1)
options(digits = 3)
pi
')

## T16: deeply nested control flow instrumentation
run("nested-control", '
out <- 0
for (i in 1:3) {
  if (i > 1) {
    for (j in 1:2) {
      while (out < 100) {
        out <- out + i * j
        if (out %% 2 == 0) next
        break
      }
    }
  } else {
    out <- out + 1
  }
}
out
')

## T17: repeat + break
run("repeat", '
z <- 0
repeat {
  z <- z + 7
  if (z > 30) break
}
z
')

## T18: paging a huge df after trace
r <- .tr_run('huge <- data.frame(id = 1:1e6, v = rnorm(1e6))')
t0 <- proc.time()[["elapsed"]]
w <- .tr_page(1, "huge", 999900, 50, 1, 2)
cat(sprintf("[paging-1e6] %d ms, kind=%s\n", round((proc.time()[["elapsed"]] - t0) * 1000),
            jsonlite::fromJSON(w)$kind))
