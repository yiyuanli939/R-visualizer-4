# R Visualizer trace engine.
# Loaded into webR's global environment at startup. All names use the `.tr_`
# prefix so ls() on the user environment stays clean (user code runs in a
# child environment of globalenv, snapshots only cover that child).

.tr_state <- new.env(parent = emptyenv())

.tr_MAX_STEPS    <- 1000L  # global recorded-step cap
.tr_MAX_ITER     <- 100L   # per-loop fully recorded iterations
.tr_ROWS         <- 50L    # preview rows for data frames / matrices
.tr_COLS         <- 60L    # preview columns
.tr_VEC_N        <- 50L    # preview elements for vectors / lists
.tr_CHR_MAX      <- 200L   # per-cell character truncation
.tr_PRINT_LINES  <- 40L    # captured stdout lines kept per step
.tr_ENV_BYTES    <- 200e6  # budget for retained per-step environments
.tr_FP_BYTES     <- 8e6    # objects larger than this get sampled fingerprints

.tr_abort_cond <- structure(
  class = c("tr_abort", "error", "condition"),
  list(message = "trace aborted", call = NULL)
)

# ---------------------------------------------------------------------------
# Formatting helpers

.tr_chr1 <- function(x) {
  # format a single value as a display string
  if (length(x) != 1) return(paste(class(x), collapse = "/"))
  if (is.na(x)) return("NA")
  s <- if (is.numeric(x)) format(x, digits = 6, trim = TRUE) else as.character(x)
  if (nchar(s) > .tr_CHR_MAX) s <- paste0(substr(s, 1, .tr_CHR_MAX), "…")
  s
}

.tr_fmt_vec <- function(x, n = .tr_VEC_N) {
  x <- utils::head(x, n)
  if (is.factor(x)) x <- as.character(x)
  if (is.list(x)) {
    return(vapply(x, function(el) {
      if (is.null(el)) "NULL"
      else paste0("<", paste(class(el), collapse = "/"), " [", length(el), "]>")
    }, character(1)))
  }
  out <- character(length(x))
  for (i in seq_along(x)) out[i] <- .tr_chr1(x[[i]])
  out
}

.tr_col_type <- function(x) {
  if (inherits(x, "factor"))  return("fct")
  if (inherits(x, "Date"))    return("date")
  if (inherits(x, "POSIXct")) return("dttm")
  if (inherits(x, "difftime")) return("drtn")
  if (is.list(x))             return("list")
  switch(typeof(x),
    double = "dbl", integer = "int", character = "chr",
    logical = "lgl", complex = "cpl", typeof(x))
}

.tr_deparse <- function(e, max = 100L) {
  s <- paste(deparse(e, width.cutoff = 120L), collapse = " ")
  if (nchar(s) > max) s <- paste0(substr(s, 1, max), "…")
  s
}

# ---------------------------------------------------------------------------
# Generic OOP object tree.
# One recursive structural inspector that speaks every R object system:
#   S3  -> attributes + underlying data
#   S4  -> slotNames() + slot()
#   S7  -> S7::props() (falling back to attributes, where S7 stores them)
#   R6 / environments -> fields and methods via ls()
#   ggproto -> class chain only (they are huge self-referential envs)
#   lists -> elements; atomics -> value previews; closures -> signatures
# Class-specific "lenses" add a human summary at the root (ggplot, lm, ...).

.tr_TREE_DEPTH <- 4L
.tr_TREE_KIDS <- 20L

.tr_prop <- function(x, name) {
  v <- attr(x, name, exact = TRUE)
  if (!is.null(v)) return(v)
  tryCatch(x[[name]], error = function(e) NULL)
}

.tr_aes_text <- function(m) {
  if (is.null(m) || !length(m)) return("")
  vals <- vapply(seq_along(m), function(i) {
    q <- m[[i]]
    s <- .tr_deparse(q, 24L)
    sub("^~", "", s)
  }, character(1))
  paste(paste0(names(m), "=", vals), collapse = ", ")
}

.tr_lens_ggplot <- function(p) {
  tryCatch({
    layers <- .tr_prop(p, "layers")
    geoms <- if (length(layers)) vapply(layers, function(l) {
      g <- tryCatch(class(l$geom)[1], error = function(e) "?")
      tolower(sub("^Geom", "", g))
    }, character(1)) else character(0)
    mapping <- .tr_aes_text(.tr_prop(p, "mapping"))
    labs <- .tr_prop(p, "labs")
    if (is.null(labs)) labs <- .tr_prop(p, "labels")
    d <- .tr_prop(p, "data")
    dims <- if (is.data.frame(d)) sprintf("%d×%d", nrow(d), ncol(d)) else NULL
    short <- sprintf("%d layer%s%s", length(geoms), if (length(geoms) == 1) "" else "s",
                     if (length(geoms)) paste0(": ", paste(geoms, collapse = "+")) else "")
    full <- paste(c(
      if (!is.null(dims)) paste0("data ", dims),
      if (nzchar(mapping)) paste0("aes(", mapping, ")"),
      short,
      if (length(labs)) paste0("labs: ", paste(names(labs), collapse = ", "))
    ), collapse = " · ")
    list(short = short, full = full)
  }, error = function(e) NULL)
}

.tr_lens_lm <- function(m) {
  tryCatch({
    fml <- .tr_deparse(stats::formula(m), 50L)
    k <- length(stats::coef(m))
    list(short = sprintf("%s: %s (%d coef)", class(m)[1], fml, k),
         full = sprintf("%s · %s · %d coefficients · n=%d",
                        class(m)[1], fml, k,
                        tryCatch(length(stats::residuals(m)), error = function(e) NA)))
  }, error = function(e) NULL)
}

.tr_lens <- function(obj) {
  if (.tr_ggish(obj)) return(.tr_lens_ggplot(obj))
  if (inherits(obj, c("lm", "glm"))) return(.tr_lens_lm(obj))
  if (inherits(obj, "htest")) {
    return(tryCatch(list(
      short = obj$method,
      full = sprintf("%s · p = %.4g", obj$method, obj$p.value)), error = function(e) NULL))
  }
  NULL
}

.tr_env_key <- function(e) {
  tryCatch(format(e), error = function(e2) paste0("env", sample.int(1e9, 1)))
}

.tr_object_tree <- function(obj, depth = 0L, seen = character(0)) {
  cls <- class(obj)
  node <- list(cls = as.list(cls))
  kids <- list()
  add_kid <- function(name, child) kids[[length(kids) + 1L]] <<- c(list(name = name), child)
  cap <- function(names_vec) {
    if (length(names_vec) > .tr_TREE_KIDS) {
      node$truncated <<- TRUE
      names_vec[seq_len(.tr_TREE_KIDS)]
    } else names_vec
  }
  deep <- depth >= .tr_TREE_DEPTH

  if (is.null(obj)) {
    node$type <- "null"
  } else if (inherits(obj, "ggproto")) {
    # huge self-referential environments; identify, do not descend
    node$type <- "ggproto"
  } else if (inherits(obj, "S7_object") && !is.function(obj)) {
    node$type <- "s7"
    props <- NULL
    if (requireNamespace("S7", quietly = TRUE)) {
      props <- tryCatch(S7::props(obj), error = function(e) NULL)
    }
    if (is.null(props)) {
      a <- attributes(obj)
      props <- a[setdiff(names(a), c("class", "S7_class", "names"))]
    }
    if (!deep && length(props)) {
      for (nm in cap(names(props))) {
        add_kid(paste0("@", nm), .tr_object_tree(props[[nm]], depth + 1L, seen))
      }
    }
  } else if (isS4(obj)) {
    node$type <- "s4"
    sn <- tryCatch(methods::slotNames(class(obj)), error = function(e) character(0))
    if (!deep) for (nm in cap(sn)) {
      sv <- tryCatch(methods::slot(obj, nm), error = function(e) NULL)
      add_kid(paste0("@", nm), .tr_object_tree(sv, depth + 1L, seen))
    }
  } else if (inherits(obj, "R6")) {
    node$type <- "r6"
    node$refId <- .tr_env_key(obj)
    nms <- tryCatch(ls(obj), error = function(e) character(0))
    if (!deep) for (nm in cap(nms)) {
      v <- tryCatch(obj[[nm]], error = function(e) NULL)
      if (is.function(v)) {
        add_kid(paste0(nm, "()"), list(cls = list("function"), type = "function",
                                       sig = .tr_deparse(args(v), 60L)))
      } else {
        add_kid(paste0("$", nm), .tr_object_tree(v, depth + 1L, seen))
      }
    }
  } else if (is.environment(obj)) {
    key <- .tr_env_key(obj)
    node$type <- "env"
    node$refId <- key
    if (key %in% seen) {
      node$cycle <- TRUE
    } else if (!deep) {
      nms <- tryCatch(ls(obj), error = function(e) character(0))
      for (nm in cap(nms)) {
        v <- tryCatch(get(nm, envir = obj, inherits = FALSE), error = function(e) NULL)
        add_kid(paste0("$", nm), .tr_object_tree(v, depth + 1L, c(seen, key)))
      }
    }
  } else if (is.data.frame(obj)) {
    node$type <- "df"
    node$dims <- sprintf("%d × %d", nrow(obj), ncol(obj))
  } else if (is.matrix(obj)) {
    node$type <- "matrix"
    node$dims <- sprintf("%d × %d", nrow(obj), ncol(obj))
  } else if (is.factor(obj)) {
    node$type <- "factor"
    node$preview <- as.list(.tr_fmt_vec(obj, 6L))
    node$n <- length(obj)
    node$dims <- sprintf("%d levels", nlevels(obj))
  } else if (is.atomic(obj)) {
    node$type <- "atomic"
    node$n <- length(obj)
    node$vtype <- .tr_col_type(obj)
    node$preview <- as.list(.tr_fmt_vec(obj, 6L))
  } else if (is.function(obj)) {
    node$type <- "function"
    node$sig <- .tr_deparse(args(obj), 70L)
  } else if (is.list(obj)) {
    node$type <- "list"
    node$n <- length(obj)
    nms <- names(obj)
    if (!deep && length(obj)) {
      idx <- seq_len(min(length(obj), .tr_TREE_KIDS))
      if (length(obj) > .tr_TREE_KIDS) node$truncated <- TRUE
      for (i in idx) {
        nm <- if (!is.null(nms) && nzchar(nms[i])) paste0("$", nms[i]) else paste0("[[", i, "]]")
        add_kid(nm, .tr_object_tree(obj[[i]], depth + 1L, seen))
      }
    }
    # meaningful S3 attributes on classed lists
    if (!deep && !identical(cls, "list")) {
      a <- attributes(obj)
      extra <- setdiff(names(a), c("names", "class", "row.names"))
      for (nm in utils::head(extra, 5L)) {
        add_kid(paste0("attr(", nm, ")"), .tr_object_tree(a[[nm]], depth + 1L, seen))
      }
    }
  } else {
    node$type <- "other"
  }

  if (depth == 0L) {
    lens <- .tr_lens(obj)
    if (!is.null(lens)) {
      node$summary <- lens$short
      node$summaryFull <- lens$full
    }
    node$size <- tryCatch(as.numeric(utils::object.size(obj)), error = function(e) NULL)
  }
  if (length(kids)) node$children <- kids
  node
}

# ---------------------------------------------------------------------------
# Object previews & fingerprints

.tr_fingerprint <- function(obj) {
  ok <- .tr_state$has_digest
  fp_of <- function(o) {
    if (ok) digest::digest(o, algo = "xxhash64")
    else paste(class(o)[1], length(o), paste(utils::head(unlist(dim(o)), 2), collapse = "x"))
  }
  if (is.environment(obj)) {
    # fingerprint contents, not the reference
    snap <- tryCatch({
      nms <- ls(obj, sorted = TRUE)
      lapply(utils::head(nms, 100), function(n)
        tryCatch(get(n, envir = obj, inherits = FALSE), error = function(e) NULL))
    }, error = function(e) list())
    return(paste0("e:", fp_of(list(class(obj), snap))))
  }
  sz <- tryCatch(as.numeric(object.size(obj)), error = function(e) 0)
  if (sz > .tr_FP_BYTES) {
    # sampled fingerprint for large objects: dims + head/tail slices
    slice <- tryCatch({
      if (is.data.frame(obj)) list(dim(obj), names(obj), utils::head(obj, 20), utils::tail(obj, 5))
      else if (is.matrix(obj)) list(dim(obj), obj[seq_len(min(20, nrow(obj))), , drop = FALSE])
      else list(length(obj), utils::head(obj, 100), utils::tail(obj, 20))
    }, error = function(e) list(class(obj), sz))
    return(paste0("s:", fp_of(slice)))
  }
  tryCatch(fp_of(obj), error = function(e) paste0("e:", class(obj)[1], length(obj)))
}

.tr_preview_df <- function(obj) {
  nr <- nrow(obj); nc <- ncol(obj)
  cw <- min(nc, .tr_COLS); rw <- min(nr, .tr_ROWS)
  cols <- vector("list", cw)
  cells <- vector("list", cw)
  nms <- colnames(obj)
  if (is.null(nms)) nms <- paste0("V", seq_len(nc))
  for (j in seq_len(cw)) {
    col <- obj[[j]]
    cols[[j]] <- list(name = nms[j], type = .tr_col_type(col))
    cells[[j]] <- .tr_fmt_vec(col, rw)
  }
  rn <- NULL
  if (!identical(attr(obj, "row.names"), seq_len(nr)) && !is.null(rownames(obj))) {
    rnv <- rownames(obj)
    if (!all(grepl("^[0-9]+$", utils::head(rnv, rw)))) rn <- utils::head(rnv, rw)
  }
  list(kind = "data.frame", nrow = nr, ncol = nc, cols = cols, cells = cells, rowNames = rn)
}

.tr_preview_matrix <- function(obj) {
  nr <- nrow(obj); nc <- ncol(obj)
  cw <- min(nc, .tr_COLS); rw <- min(nr, .tr_ROWS)
  cols <- vector("list", cw)
  cells <- vector("list", cw)
  nms <- colnames(obj)
  for (j in seq_len(cw)) {
    cols[[j]] <- list(name = if (is.null(nms)) paste0("[,", j, "]") else nms[j],
                      type = .tr_col_type(obj[, j]))
    cells[[j]] <- .tr_fmt_vec(obj[seq_len(rw), j], rw)
  }
  rn <- if (!is.null(rownames(obj))) utils::head(rownames(obj), rw) else NULL
  list(kind = "matrix", nrow = nr, ncol = nc, cols = cols, cells = cells, rowNames = rn)
}

.tr_preview <- function(name, obj) {
  base <- list(name = name, cls = class(obj),
               size = tryCatch(as.numeric(object.size(obj)), error = function(e) NULL))
  body <- tryCatch({
    if (is.null(obj)) list(kind = "null")
    else if (is.data.frame(obj)) .tr_preview_df(obj)
    else if (is.matrix(obj)) .tr_preview_matrix(obj)
    else if (is.factor(obj)) list(kind = "factor", length = length(obj),
                                  values = .tr_fmt_vec(obj), nlevels = nlevels(obj),
                                  levels = utils::head(levels(obj), 20))
    else if (is.atomic(obj)) {
      v <- list(kind = "vector", vtype = .tr_col_type(obj), length = length(obj),
                values = .tr_fmt_vec(obj))
      if (!is.null(names(obj))) v$names <- utils::head(names(obj), .tr_VEC_N)
      v
    }
    else if (is.function(obj) && !inherits(obj, "S7_object")) {
      sig <- tryCatch(paste(utils::head(deparse(args(obj)), 3), collapse = " "),
                      error = function(e) "function(...)")
      list(kind = "function", args = sub("\\s*NULL\\s*$", "", sig))
    }
    else {
      # everything object-shaped — S3 lists, S4, S7, R6, environments, models,
      # plot objects — goes through the generic structural inspector.
      # NEVER print() here: printing a plot object would draw it.
      tree <- .tr_object_tree(obj)
      list(kind = "object", summary = tree$summary, tree = tree)
    }
  }, error = function(e) list(kind = "other", print = paste("<preview error:", conditionMessage(e), ">")))
  c(base, body)
}

# ---------------------------------------------------------------------------
# Environment snapshots (with cross-step structural sharing)

# Delta snapshots: each step emits previews ONLY for objects that appeared or
# changed, plus the names of removed ones. The frontend reconstructs the full
# environment cumulatively. Unchanged objects are detected with identical()
# (fast pointer path for untouched bindings) so their fingerprints are reused
# without hashing — keeping cost O(changed) instead of O(all vars) per step.
.tr_snapshot <- function(env) {
  nms <- ls(env, sorted = TRUE)
  prev_fps <- .tr_state$prev_fps
  prev_vals <- .tr_state$prev_vals
  prev_names <- names(prev_fps)
  objs <- list()
  added <- character(0); changed <- character(0)
  new_fps <- vector("list", length(nms)); names(new_fps) <- nms
  new_vals <- vector("list", length(nms)); names(new_vals) <- nms
  for (nm in nms) {
    obj <- get(nm, envir = env, inherits = FALSE)
    new_vals[[nm]] <- list(obj)  # wrap so NULL values survive list storage
    # environments (and R6 objects) mutate in place: pointer identity cannot
    # detect changes, so they always go through content fingerprinting
    by_ref <- is.environment(obj)
    if (nm %in% prev_names) {
      if (!by_ref && identical(prev_vals[[nm]][[1]], obj)) {
        new_fps[[nm]] <- prev_fps[[nm]]
      } else {
        fp <- .tr_fingerprint(obj)
        new_fps[[nm]] <- fp
        if (!identical(fp, prev_fps[[nm]])) {
          changed <- c(changed, nm)
          pv <- c(.tr_preview(nm, obj), list(fp = fp))
          # dataset-semantics delta for ANY modified data frame — base-R
          # assignments, subset(), merge(), df$x <- ... — not just pipes
          old_val <- prev_vals[[nm]][[1]]
          if (is.data.frame(obj) && is.data.frame(old_val)) {
            pv$delta <- tryCatch(.tr_data_delta(old_val, obj), error = function(e) NULL)
          }
          objs[[length(objs) + 1L]] <- pv
        }
      }
    } else {
      fp <- .tr_fingerprint(obj)
      new_fps[[nm]] <- fp
      added <- c(added, nm)
      pv <- c(.tr_preview(nm, obj), list(fp = fp))
      # first appearance of a data frame (e.g. m <- merge(..., all.x = TRUE)):
      # no previous value to diff, but NA-bearing columns are worth flagging —
      # for left joins the NA count IS the number of unmatched rows
      if (is.data.frame(obj) && nrow(obj) <= .tr_DELTA_MAX_ROWS) {
        nai <- list()
        for (cc in utils::head(names(obj), 60L)) {
          n <- tryCatch(sum(is.na(obj[[cc]])), error = function(e) 0L)
          if (n > 0) nai[[length(nai) + 1L]] <- list(col = cc, n = n)
          if (length(nai) >= 6L) break
        }
        if (length(nai)) pv$delta <- list(naIntro = nai)
      }
      objs[[length(objs) + 1L]] <- pv
    }
  }
  removed <- if (is.null(prev_names)) character(0) else setdiff(prev_names, nms)
  .tr_state$prev_fps <- new_fps
  .tr_state$prev_vals <- new_vals
  list(objs = objs, added = added, changed = changed, removed = removed)
}

.tr_store_env <- function(step_idx, env, changed_names) {
  if (!.tr_state$env_store_ok) return(FALSE)
  add <- 0
  for (nm in changed_names) {
    add <- add + tryCatch(as.numeric(object.size(get(nm, envir = env, inherits = FALSE))),
                          error = function(e) 0)
  }
  .tr_state$env_bytes <- .tr_state$env_bytes + add
  if (.tr_state$env_bytes > .tr_ENV_BYTES) {
    .tr_state$env_store_ok <- FALSE
    return(FALSE)
  }
  nms <- ls(env)
  .tr_state$step_envs[[as.character(step_idx)]] <-
    if (length(nms)) mget(nms, envir = env) else list()
  TRUE
}

# ---------------------------------------------------------------------------
# Plot tracking. Plots are drawn live on whatever device is current (during a
# real run that is webR's capturing canvas, so images arrive with the trace).
# We count pages via plot-new hooks and attach new page ids to the step that
# started them. Known limit: additions to an existing page (points(), lines())
# and par(mfrow=...) sub-figures are not tracked as separate plots.

.tr_page_bump <- function(...) {
  .tr_state$page_count <- .tr_state$page_count + 1L
  invisible(NULL)
}

.tr_plot_check <- function() {
  n <- .tr_state$page_count
  seen <- .tr_state$page_seen
  if (n <= seen) return(integer(0))
  .tr_state$page_seen <- n
  seq.int(seen + 1L, n)
}

# ---------------------------------------------------------------------------
# Step recording

.tr_recording <- function() {
  if (.tr_state$truncated) return(FALSE)
  if (length(.tr_state$steps) >= .tr_state$max_steps) {
    .tr_state$truncated <- TRUE
    return(FALSE)
  }
  for (inst in .tr_state$loop_stack) if (inst$folding) return(FALSE)
  TRUE
}

.tr_loop_info <- function() {
  if (!length(.tr_state$loop_stack)) return(NULL)
  lapply(.tr_state$loop_stack, function(inst)
    list(var = inst$var, iter = inst$iter, value = inst$value))
}

.tr_record <- function(kind, l1, l2, stdout_lines, conds, error_msg = NULL,
                       pipe = NULL, env = NULL, note = NULL) {
  if (!.tr_recording()) {
    # error steps may exceed the cap, but only within a small buffer so a
    # cascade of failures cannot grow the trace unboundedly
    if (is.null(error_msg) ||
        length(.tr_state$steps) >= .tr_state$max_steps + 50L)
      return(invisible(NULL))
  }
  if (length(stdout_lines) > .tr_PRINT_LINES) {
    stdout_lines <- c(utils::head(stdout_lines, .tr_PRINT_LINES),
                      paste0("… (", length(stdout_lines) - .tr_PRINT_LINES, " more lines)"))
  }
  idx <- length(.tr_state$steps) + 1L
  snap <- .tr_snapshot(.tr_state$user_env)
  stored <- .tr_store_env(idx, .tr_state$user_env, c(snap$added, snap$changed))
  snap$stored <- stored
  step <- list(
    i = idx, line1 = l1, line2 = l2, kind = kind,
    stdout = stdout_lines,
    conds = conds,
    plots = as.list(.tr_plot_check()),
    loop = .tr_loop_info(),
    env = snap
  )
  if (!is.null(error_msg)) step$errorMsg <- error_msg
  if (!is.null(pipe)) step$pipe <- pipe
  if (!is.null(note)) step$note <- note
  .tr_state$steps[[idx]] <- step
  invisible(idx)
}

# Evaluate `expr` in `env` capturing stdout / messages / warnings / error.
.tr_capture_eval <- function(expr, env, auto_print = FALSE) {
  conds <- list(); err <- NULL; res <- NULL
  h_message <- function(m) {
    conds[[length(conds) + 1L]] <<- list(type = "message",
                                         text = sub("\n$", "", conditionMessage(m)))
    invokeRestart("muffleMessage")
  }
  h_warning <- function(w) {
    conds[[length(conds) + 1L]] <<- list(type = "warning", text = conditionMessage(w))
    invokeRestart("muffleWarning")
  }
  out <- utils::capture.output({
    res <- tryCatch(
      withCallingHandlers(withVisible(eval(expr, envir = env)),
                          message = h_message, warning = h_warning),
      error = function(e) { err <<- conditionMessage(e); NULL }
    )
    if (is.null(err) && auto_print && isTRUE(res$visible) && !is.null(res$value)) {
      # printing can itself emit output/conditions (e.g. rendering a ggplot)
      tryCatch(
        withCallingHandlers(print(res$value), message = h_message, warning = h_warning),
        error = function(e) cat("<print error:", conditionMessage(e), ">\n")
      )
    }
  }, type = "output")
  list(value = if (is.null(err)) res$value else NULL,
       visible = if (is.null(err)) res$visible else FALSE,
       stdout = out, conds = conds, error = err)
}

# ---------------------------------------------------------------------------
# Pipe chains

.tr_is_pipe <- function(e) {
  is.call(e) && length(e) == 3L && is.symbol(e[[1]]) &&
    as.character(e[[1]]) == "%>%"
}

# The native |> is expanded by the parser (`a |> f()` parses to `f(a)`), so it
# never appears in the AST. We count `|>` in the statement's source text and
# unwrap that many first-argument call layers from the nested-call spine.
.tr_count_native <- function(src_txt) {
  if (is.null(src_txt) || !nzchar(src_txt)) return(0L)
  clean <- gsub("\"[^\"]*\"", "\"\"", src_txt)
  clean <- gsub("'[^']*'", "''", clean)
  clean <- gsub("#[^\n]*", "", clean)
  m <- gregexpr("|>", clean, fixed = TRUE)[[1]]
  if (length(m) == 1L && m[1] == -1L) 0L else length(m)
}

.tr_can_unwrap <- function(e) {
  if (!is.call(e) || length(e) < 2L) return(FALSE)
  h <- e[[1]]
  if (is.symbol(h) && as.character(h) %in%
      c("<-", "=", "<<-", "if", "for", "while", "repeat", "{", "(", "[", "[[",
        "$", "@", "::", ":::", "function", "+", "-", "*", "/", "^", "!", "~",
        "&", "&&", "|", "||", "<", ">", "<=", ">=", "==", "!=", ":", "?"))
    return(FALSE)
  nm <- names(as.list(e))
  if (!is.null(nm) && length(nm) >= 2L && nzchar(nm[2])) return(FALSE)  # named first arg
  TRUE
}

.tr_split_pipe <- function(e, native_n = 0L) {
  links <- list()
  cur <- e
  repeat {
    if (.tr_is_pipe(cur)) {
      links <- c(list(list(op = "%>%", rhs = cur[[3]])), links)
      cur <- cur[[2]]
    } else if (native_n > 0L && .tr_can_unwrap(cur)) {
      parts <- as.list(cur)
      rhs <- as.call(parts[-2])
      links <- c(list(list(op = "|>", rhs = rhs)), links)
      cur <- cur[[2]]
      native_n <- native_n - 1L
    } else break
  }
  if (!length(links)) return(NULL)
  list(head = cur, links = links)
}

.tr_quote_val <- function(v) {
  if (is.language(v) || is.symbol(v)) as.call(list(quote(quote), v)) else v
}

# Build the call for one pipe link applied to value `v`. Returns NULL if the
# link shape is unsupported (caller falls back to whole-statement evaluation).
.tr_link_call <- function(op, rhs, v) {
  vq <- .tr_quote_val(v)
  if (op == "|>") {
    # rhs is the reconstructed call with its first argument removed;
    # re-insert the piped value as the (unnamed) first argument
    if (!is.call(rhs)) return(NULL)
    args <- as.list(rhs)
    return(as.call(append(args, list(vq), after = 1L)))
  }
  # %>% — magrittr semantics: insert lhs as first argument unless `.` appears
  # as a TOP-LEVEL argument; a nested `.` (e.g. lm(y ~ x, .)) does not
  # suppress insertion. In every case `.` must also be bound to the lhs value
  # during evaluation (see .tr_link_env).
  if (is.symbol(rhs)) return(as.call(list(rhs, vq)))
  if (is.call(rhs)) {
    h <- rhs[[1]]
    if (is.symbol(h) && as.character(h) == "(") return(as.call(list(rhs, vq)))
    if (is.symbol(h) && as.character(h) %in% c("::", ":::") && length(rhs) == 3L)
      return(as.call(list(rhs, vq)))
    args <- as.list(rhs)
    ph <- FALSE
    for (j in seq_along(args)[-1]) {
      if (identical(args[[j]], quote(.))) { args[[j]] <- vq; ph <- TRUE }
    }
    if (!ph) args <- append(args, list(vq), after = 1L)
    return(as.call(args))
  }
  NULL
}

# Evaluation environment for a %>% link: a throwaway child of `env` with `.`
# bound to the piped value, so nested `.` references resolve like magrittr.
.tr_link_env <- function(op, env, v) {
  if (op != "%>%") return(env)
  e2 <- new.env(parent = env)
  assign(".", v, envir = e2)
  e2
}

.tr_stmt_src <- function(l1, l2) {
  src <- .tr_state$src_lines
  if (is.null(src) || l1 < 1 || l2 < l1 || l2 > length(src)) return(NULL)
  paste(src[l1:l2], collapse = "\n")
}

# Dataset-semantics delta between consecutive pipe/chain values: which
# columns appeared/vanished/changed, how many rows were removed/added (with a
# sample of the removed rows, matched by row content), and whether the step
# merely reordered rows. Exact row matching is done on tables up to 5000 rows.
.tr_DELTA_MAX_ROWS <- 5000L

.tr_data_delta <- function(prev, cur) {
  if (!is.data.frame(prev) || !is.data.frame(cur)) return(NULL)
  out <- list()
  pn <- names(prev); cn <- names(cur)
  out$colsAdded <- as.list(setdiff(cn, pn))
  out$colsRemoved <- as.list(setdiff(pn, cn))
  shared <- intersect(pn, cn)
  out$rowDelta <- nrow(cur) - nrow(prev)
  small <- nrow(prev) <= .tr_DELTA_MAX_ROWS && nrow(cur) <= .tr_DELTA_MAX_ROWS
  chg <- character(0)
  if (nrow(prev) == nrow(cur)) {
    for (cc in shared) {
      if (!identical(prev[[cc]], cur[[cc]])) chg <- c(chg, cc)
    }
    # pure reorder? same multiset of rows on shared columns
    if (length(chg) && small && length(shared)) {
      kp <- tryCatch(sort(do.call(paste, c(lapply(prev[shared], as.character), sep = "\r"))),
                     error = function(e) NULL)
      kc <- tryCatch(sort(do.call(paste, c(lapply(cur[shared], as.character), sep = "\r"))),
                     error = function(e) NULL)
      if (!is.null(kp) && identical(kp, kc)) {
        out$reordered <- TRUE
        chg <- character(0)
      }
    }
  }
  out$colsChanged <- as.list(chg)
  # type changes on shared columns (chr -> fct etc.) are invisible in cells
  ret <- list()
  for (cc in shared) {
    tp <- .tr_col_type(prev[[cc]]); tc <- .tr_col_type(cur[[cc]])
    if (!identical(tp, tc)) {
      ret[[length(ret) + 1L]] <- list(col = cc, from = tp, to = tc)
    } else if (tp == "fct" && nlevels(prev[[cc]]) != nlevels(cur[[cc]])) {
      # level-set changes (droplevels, recodes) are invisible in the cells
      ret[[length(ret) + 1L]] <- list(
        col = cc,
        from = sprintf("fct(%d)", nlevels(prev[[cc]])),
        to = sprintf("fct(%d)", nlevels(cur[[cc]])))
    }
  }
  if (length(ret)) out$colsRetyped <- ret
  # NAs introduced: analysis footgun for mutate coercions and left_join misses
  nai <- list()
  for (cc in c(unlist(out$colsAdded), chg)) {
    n_new <- sum(is.na(cur[[cc]]))
    n_old <- if (cc %in% pn) sum(is.na(prev[[cc]])) else 0L
    if (n_new > n_old) nai[[length(nai) + 1L]] <- list(col = cc, n = n_new - n_old)
  }
  if (length(nai)) out$naIntro <- nai
  # grouping state is invisible in the data yet changes later behaviour —
  # surface it explicitly
  if (inherits(cur, "grouped_df")) {
    out$groups <- tryCatch(as.list(setdiff(names(attr(cur, "groups")), ".rows")),
                           error = function(e) NULL)
  }
  # a removed-rows sample only makes sense when the columns are unchanged
  # (filter/slice-like); after summarise/select the old rows aren't "removed",
  # the table's shape itself changed
  if (out$rowDelta < 0 && small && length(shared) &&
      !length(out$colsAdded) && !length(out$colsRemoved)) {
    kprev <- tryCatch(do.call(paste, c(lapply(prev[shared], as.character), sep = "\r")),
                      error = function(e) NULL)
    kcur <- tryCatch(do.call(paste, c(lapply(cur[shared], as.character), sep = "\r")),
                     error = function(e) NULL)
    if (!is.null(kprev) && !is.null(kcur)) {
      gone <- which(!(kprev %in% kcur))
      out$rowsRemovedExact <- length(gone)
      smp <- prev[utils::head(gone, 4L), utils::head(seq_along(pn), 5L), drop = FALSE]
      out$removedSample <- lapply(seq_len(nrow(smp)), function(i)
        paste(names(smp), vapply(smp[i, , drop = FALSE], function(x) .tr_chr1(x[[1]]),
                                 character(1)),
              sep = "=", collapse = " · "))
    }
  }
  if (!length(out$colsAdded) && !length(out$colsRemoved) && !length(out$colsChanged) &&
      out$rowDelta == 0 && is.null(out$reordered) && is.null(out$groups) &&
      is.null(out$colsRetyped) && is.null(out$naIntro)) return(NULL)
  out
}

.tr_pipe_store <- function(v) {
  if (!.tr_state$pipe_store_ok) return(NULL)
  sz <- tryCatch(as.numeric(object.size(v)), error = function(e) 0)
  .tr_state$pipe_bytes <- .tr_state$pipe_bytes + sz
  if (.tr_state$pipe_bytes > .tr_ENV_BYTES) {
    .tr_state$pipe_store_ok <- FALSE
    return(NULL)
  }
  id <- length(.tr_state$pipe_vals) + 1L
  .tr_state$pipe_vals[[id]] <- v
  id
}

# Run a decomposed pipe statement. Returns TRUE if handled, FALSE to fall back.
.tr_run_pipe <- function(stmt, env, l1, l2, top) {
  lhs <- NULL; chain_expr <- stmt
  if (is.call(stmt) && length(stmt) == 3L && is.symbol(stmt[[1]]) &&
      as.character(stmt[[1]]) %in% c("<-", "=", "<<-")) {
    lhs <- stmt[[2]]; chain_expr <- stmt[[3]]
  }
  src_txt <- .tr_stmt_src(l1, l2)
  sp <- .tr_split_pipe(chain_expr, .tr_count_native(src_txt))
  if (is.null(sp)) return(FALSE)
  # pre-validate link shapes with a dummy value so we can fall back cleanly
  for (lk in sp$links) if (is.null(.tr_link_call(lk$op, lk$rhs, 0))) return(FALSE)

  total <- length(sp$links) + 1L
  # step 1: head of the chain
  r <- .tr_capture_eval(sp$head, env, auto_print = FALSE)
  if (!is.null(r$error)) {
    .tr_record("error", l1, l2, r$stdout, r$conds, error_msg = r$error,
               pipe = list(index = 1L, total = total, label = .tr_deparse(sp$head, 60L)))
    stop(.tr_abort_cond)
  }
  v <- r$value
  .tr_record("pipe", l1, l2, r$stdout, r$conds,
             pipe = list(index = 1L, total = total, label = .tr_deparse(sp$head, 60L),
                         value = .tr_preview(".pipe", v), storeId = .tr_pipe_store(v)))
  for (k in seq_along(sp$links)) {
    op_k <- sp$links[[k]]$op
    lk <- sp$links[[k]]
    cl <- .tr_link_call(lk$op, lk$rhs, v)
    last <- k == length(sp$links)
    r <- .tr_capture_eval(cl, .tr_link_env(lk$op, env, v), auto_print = FALSE)
    if (!is.null(r$error)) {
      .tr_record("error", l1, l2, r$stdout, r$conds, error_msg = r$error,
                 pipe = list(index = k + 1L, total = total, label = .tr_deparse(lk$rhs, 60L)))
      stop(.tr_abort_cond)
    }
    prev_v <- v
    v <- r$value
    delta <- tryCatch(.tr_data_delta(prev_v, v), error = function(e) NULL)
    stdout_lines <- r$stdout
    if (last) {
      if (!is.null(lhs)) {
        eval(call("<-", lhs, .tr_quote_val(v)), envir = env)
      } else if (top && isTRUE(r$visible) && !is.null(v)) {
        p_out <- tryCatch(utils::capture.output(print(v)), error = function(e) character(0))
        stdout_lines <- c(stdout_lines, p_out)
      }
    }
    .tr_record("pipe", l1, l2, stdout_lines, r$conds,
               pipe = list(index = k + 1L, total = total, op = op_k,
                           label = .tr_deparse(lk$rhs, 60L), delta = delta,
                           value = .tr_preview(".pipe", v), storeId = .tr_pipe_store(v)))
  }
  TRUE
}

# ---------------------------------------------------------------------------
# `+` operator chains (grammar-of-graphics style object composition).
# `p <- ggplot(d, aes(x, y)) + geom_point() + labs(...)` is a left-associative
# fold, structurally identical to a pipe spine. We evaluate the head first;
# if it is a graphics-grammar object the chain is recorded link by link
# (op = "+"), otherwise the links are folded silently and the statement is
# recorded as a single step — so arithmetic like 1 + 2 + 3 is untouched and
# nothing is ever evaluated twice.

.tr_split_plus <- function(e) {
  links <- list()
  cur <- e
  while (is.call(cur) && length(cur) == 3L && is.symbol(cur[[1]]) &&
         as.character(cur[[1]]) == "+") {
    links <- c(list(list(op = "+", rhs = cur[[3]])), links)
    cur <- cur[[2]]
  }
  if (!length(links)) return(NULL)
  list(head = cur, links = links)
}

.tr_ggish <- function(v) inherits(v, "gg") || inherits(v, "ggplot")

.tr_run_plus <- function(stmt, env, l1, l2, top) {
  lhs <- NULL; chain_expr <- stmt
  if (is.call(stmt) && length(stmt) == 3L && is.symbol(stmt[[1]]) &&
      as.character(stmt[[1]]) %in% c("<-", "=", "<<-")) {
    lhs <- stmt[[2]]; chain_expr <- stmt[[3]]
  }
  sp <- .tr_split_plus(chain_expr)
  if (is.null(sp)) return(FALSE)
  total <- length(sp$links) + 1L

  r <- .tr_capture_eval(sp$head, env, auto_print = FALSE)
  if (!is.null(r$error)) {
    .tr_record("error", l1, l2, r$stdout, r$conds, error_msg = r$error,
               pipe = list(index = 1L, total = total, op = "+",
                           label = .tr_deparse(sp$head, 60L)))
    stop(.tr_abort_cond)
  }
  v <- r$value
  record <- .tr_ggish(v)
  agg_out <- r$stdout; agg_conds <- r$conds
  if (record) {
    .tr_record("pipe", l1, l2, r$stdout, r$conds,
               pipe = list(index = 1L, total = total, op = "+",
                           label = .tr_deparse(sp$head, 60L),
                           value = .tr_preview(".pipe", v),
                           storeId = .tr_pipe_store(v)))
  }
  vis <- r$visible
  for (k in seq_along(sp$links)) {
    lk <- sp$links[[k]]
    cl <- as.call(list(quote(`+`), .tr_quote_val(v), lk$rhs))
    last <- k == length(sp$links)
    r <- .tr_capture_eval(cl, env, auto_print = FALSE)
    if (!is.null(r$error)) {
      .tr_record("error", l1, l2, c(agg_out, r$stdout), c(agg_conds, r$conds),
                 error_msg = r$error,
                 pipe = if (record) list(index = k + 1L, total = total, op = "+",
                                         label = .tr_deparse(lk$rhs, 60L)))
      stop(.tr_abort_cond)
    }
    v <- r$value; vis <- r$visible
    if (record) {
      stdout_lines <- r$stdout
      if (last) {
        if (!is.null(lhs)) {
          eval(call("<-", lhs, .tr_quote_val(v)), envir = env)
        } else if (top && isTRUE(vis) && !is.null(v)) {
          p_out <- tryCatch(utils::capture.output(print(v)), error = function(e) character(0))
          stdout_lines <- c(stdout_lines, p_out)
        }
      }
      .tr_record("pipe", l1, l2, stdout_lines, r$conds,
                 pipe = list(index = k + 1L, total = total, op = "+",
                             label = .tr_deparse(lk$rhs, 60L),
                             value = .tr_preview(".pipe", v),
                             storeId = .tr_pipe_store(v)))
    } else {
      agg_out <- c(agg_out, r$stdout); agg_conds <- c(agg_conds, r$conds)
    }
  }
  if (!record) {
    if (!is.null(lhs)) {
      eval(call("<-", lhs, .tr_quote_val(v)), envir = env)
    } else if (top && isTRUE(vis) && !is.null(v)) {
      p_out <- tryCatch(utils::capture.output(print(v)), error = function(e) character(0))
      agg_out <- c(agg_out, p_out)
    }
    .tr_record("stmt", l1, l2, agg_out, agg_conds)
  }
  TRUE
}

# ---------------------------------------------------------------------------
# Core per-statement execution

.tr_step_core <- function(e, env, l1, l2, top) {
  if (!.tr_recording()) {
    # folded / truncated: still execute for correct final state
    r <- .tr_capture_eval(e, env, auto_print = top)
    if (!is.null(r$error)) {
      .tr_record("error", l1, l2, r$stdout, r$conds, error_msg = r$error)
      stop(.tr_abort_cond)
    }
    return(invisible(NULL))
  }
  handled <- tryCatch(.tr_run_pipe(e, env, l1, l2, top),
                      tr_abort = function(c) stop(c))
  if (isTRUE(handled)) return(invisible(NULL))
  handled <- tryCatch(.tr_run_plus(e, env, l1, l2, top),
                      tr_abort = function(c) stop(c))
  if (isTRUE(handled)) return(invisible(NULL))
  r <- .tr_capture_eval(e, env, auto_print = top)
  if (!is.null(r$error)) {
    .tr_record("error", l1, l2, r$stdout, r$conds, error_msg = r$error)
    stop(.tr_abort_cond)
  }
  .tr_record("stmt", l1, l2, r$stdout, r$conds)
  invisible(NULL)
}

# Hook injected in place of each statement inside instrumented blocks.
.tr_hook <- function(expr, l1 = -1L, l2 = -1L) {
  e <- expr  # promise evaluates quote(<stmt>) -> unevaluated statement
  .tr_step_core(e, parent.frame(), l1, l2, top = FALSE)
  invisible(NULL)
}

# ---------------------------------------------------------------------------
# Loop instrumentation

.tr_iter <- function(id, var, value) {
  st <- .tr_state$loop_stack
  n <- length(st)
  if (n == 0 || st[[n]]$id != id) {
    # defensive: instance should have been pushed by .tr_with_loop
    st[[n + 1L]] <- list(id = id, var = var, iter = 0L, value = NULL, folding = FALSE,
                         l1 = -1L, l2 = -1L)
    n <- n + 1L
  }
  inst <- st[[n]]
  inst$iter <- inst$iter + 1L
  inst$value <- if (!is.null(value)) .tr_chr1(value) else NULL
  if (inst$iter > .tr_MAX_ITER) inst$folding <- TRUE
  st[[n]] <- inst
  .tr_state$loop_stack <- st
  invisible(NULL)
}

.tr_with_loop <- function(id, var, l1, l2, expr) {
  st <- .tr_state$loop_stack
  st[[length(st) + 1L]] <- list(id = id, var = var, iter = 0L, value = NULL,
                                folding = FALSE, l1 = l1, l2 = l2)
  .tr_state$loop_stack <- st
  on.exit({
    st <- .tr_state$loop_stack
    inst <- st[[length(st)]]
    .tr_state$loop_stack <- st[-length(st)]
    if (inst$folding) {
      .tr_record("loop-fold", inst$l1, inst$l2, character(0), list(),
                 note = sprintf("iterations %d…%d folded", .tr_MAX_ITER + 1L, inst$iter))
    }
  }, add = TRUE)
  eval(expr, parent.frame())
}

.tr_srcref_lines <- function(sr) {
  if (is.null(sr)) return(c(-1L, -1L))
  v <- as.integer(sr)
  c(v[1], v[3])
}

.tr_next_loop_id <- function() {
  .tr_state$loop_id <- .tr_state$loop_id + 1L
  .tr_state$loop_id
}

.tr_rw_stmt <- function(s, l1, l2) {
  if (!is.call(s)) {
    return(as.call(list(quote(.tr_hook), as.call(list(quote(quote), s)), l1, l2)))
  }
  h <- if (is.symbol(s[[1]])) as.character(s[[1]]) else ""
  if (h %in% c("next", "break")) return(s)
  if (h == "for") {
    id <- .tr_next_loop_id()
    var <- as.character(s[[2]])
    body2 <- .tr_rw_body(s[[4]], l1, l2)
    newbody <- as.call(list(quote(`{`),
      as.call(list(quote(.tr_iter), id, var, as.name(var))), body2))
    newloop <- as.call(list(quote(`for`), s[[2]], s[[3]], newbody))
    return(as.call(list(quote(.tr_with_loop), id, var, l1, l2,
                        as.call(list(quote(quote), newloop)))))
  }
  if (h == "while") {
    id <- .tr_next_loop_id()
    body2 <- .tr_rw_body(s[[3]], l1, l2)
    newbody <- as.call(list(quote(`{`),
      as.call(list(quote(.tr_iter), id, NULL, NULL)), body2))
    newloop <- as.call(list(quote(`while`), s[[2]], newbody))
    return(as.call(list(quote(.tr_with_loop), id, NULL, l1, l2,
                        as.call(list(quote(quote), newloop)))))
  }
  if (h == "repeat") {
    id <- .tr_next_loop_id()
    body2 <- .tr_rw_body(s[[2]], l1, l2)
    newbody <- as.call(list(quote(`{`),
      as.call(list(quote(.tr_iter), id, NULL, NULL)), body2))
    newloop <- as.call(list(quote(`repeat`), newbody))
    return(as.call(list(quote(.tr_with_loop), id, NULL, l1, l2,
                        as.call(list(quote(quote), newloop)))))
  }
  if (h == "{") return(.tr_rw_body(s, l1, l2))
  if (h == "if") {
    newif <- as.list(s)
    newif[[3]] <- .tr_rw_body(s[[3]], l1, l2)
    if (length(s) >= 4L) newif[[4]] <- .tr_rw_body(s[[4]], l1, l2)
    return(as.call(newif))
  }
  as.call(list(quote(.tr_hook), as.call(list(quote(quote), s)), l1, l2))
}

.tr_rw_body <- function(b, pl1, pl2) {
  if (is.call(b) && is.symbol(b[[1]]) && as.character(b[[1]]) == "{") {
    srs <- attr(b, "srcref")
    parts <- as.list(b)
    out <- vector("list", length(parts))
    out[[1]] <- parts[[1]]
    for (i in seq_along(parts)[-1]) {
      ln <- if (!is.null(srs) && length(srs) >= i) .tr_srcref_lines(srs[[i]]) else c(pl1, pl2)
      out[[i]] <- .tr_rw_stmt(parts[[i]], ln[1], ln[2])
    }
    return(as.call(out))
  }
  .tr_rw_stmt(b, pl1, pl2)
}

.tr_is_compound <- function(e) {
  is.call(e) && is.symbol(e[[1]]) &&
    as.character(e[[1]]) %in% c("for", "while", "repeat", "if", "{")
}

# ---------------------------------------------------------------------------
# Driver

.tr_reset <- function(fresh_env = TRUE) {
  s <- .tr_state
  s$steps <- list()
  s$max_steps <- .tr_MAX_STEPS
  s$page_count <- 0L
  s$page_seen <- 0L
  s$prev_fps <- NULL
  s$prev_vals <- NULL
  s$loop_stack <- list()
  s$loop_id <- 0L
  s$truncated <- FALSE
  s$step_envs <- list()
  s$env_bytes <- 0
  s$env_store_ok <- TRUE
  s$pipe_vals <- list()
  s$pipe_bytes <- 0
  s$pipe_store_ok <- TRUE
  if (isTRUE(fresh_env) || is.null(s$user_env)) {
    s$user_env <- new.env(parent = globalenv())
  }
  s$has_digest <- requireNamespace("digest", quietly = TRUE)
  invisible(NULL)
}

# stop_on_error = FALSE mimics console behaviour: an error aborts only the
# current top-level statement (a failure inside a loop kills that loop), is
# recorded as an error step, and execution moves on to the next statement.
.tr_run <- function(code, step_loops = TRUE, stop_on_error = FALSE, max_steps = 1000L,
                    fresh_env = TRUE) {
  .tr_reset(fresh_env)
  .tr_state$max_steps <- as.integer(max_steps)
  if (!isTRUE(fresh_env)) {
    # seed change-detection with the carried-over workspace so step 1 only
    # reports what this run actually touches; ship the baseline previews so
    # the frontend can still show the inherited variables
    .tr_state$baseline <- .tr_snapshot(.tr_state$user_env)$objs
  } else {
    .tr_state$baseline <- NULL
  }
  env <- .tr_state$user_env
  parse_err <- NULL
  old_pd <- options(keep.source = TRUE, keep.parse.data = TRUE)
  exprs <- tryCatch(parse(text = code, keep.source = TRUE),
                    error = function(e) { parse_err <<- conditionMessage(e); NULL })
  options(old_pd)
  if (!is.null(parse_err)) {
    json <- .tr_json(list(ok = FALSE, error = parse_err, steps = list(),
                          nPlots = 0L, truncated = FALSE))
    .tr_state$json <- json
    return(json)
  }
  srcrefs <- attr(exprs, "srcref")
  .tr_state$src_lines <- strsplit(code, "\n", fixed = TRUE)[[1]]
  # expression-node table for source-span <-> AST mapping (click-to-inspect)
  .tr_state$parse_spans <- tryCatch({
    pd <- utils::getParseData(exprs)
    if (is.null(pd)) NULL
    else {
      ex <- pd[pd$token == "expr", c("id", "parent", "line1", "col1", "line2", "col2")]
      rownames(ex) <- NULL
      if (nrow(ex) > 0 && nrow(ex) <= 20000) ex else NULL
    }
  }, error = function(e) NULL)

  old <- options(max.print = 1000, width = 100)
  old_hook_plot <- getHook("before.plot.new")
  old_hook_grid <- getHook("before.grid.newpage")
  setHook("before.plot.new", .tr_page_bump, "append")
  setHook("before.grid.newpage", .tr_page_bump, "append")
  on.exit({
    options(old)
    setHook("before.plot.new", old_hook_plot, "replace")
    setHook("before.grid.newpage", old_hook_grid, "replace")
  }, add = TRUE)

  aborted <- FALSE
  n_errors <- 0L
  for (k in seq_along(exprs)) {
    e <- exprs[[k]]
    ln <- if (!is.null(srcrefs)) .tr_srcref_lines(srcrefs[[k]]) else c(-1L, -1L)
    ok <- tryCatch({
      if (.tr_is_compound(e) && isTRUE(step_loops)) {
        rewritten <- .tr_rw_stmt(e, ln[1], ln[2])
        r <- .tr_capture_eval(rewritten, env, auto_print = FALSE)
        if (!is.null(r$error)) {
          .tr_record("error", ln[1], ln[2], r$stdout, r$conds, error_msg = r$error)
          FALSE
        } else {
          # leftover output not attributed to an inner step (e.g. cat in a
          # loop condition) is attached to the last recorded step
          if (length(r$stdout) && length(.tr_state$steps)) {
            li <- length(.tr_state$steps)
            .tr_state$steps[[li]]$stdout <- c(.tr_state$steps[[li]]$stdout, r$stdout)
          }
          TRUE
        }
      } else {
        .tr_step_core(e, env, ln[1], ln[2], top = TRUE)
        TRUE
      }
    }, tr_abort = function(c) FALSE)
    if (!ok) {
      n_errors <- n_errors + 1L
      if (isTRUE(stop_on_error)) { aborted <- TRUE; break }
    }
  }

  json <- .tr_json(list(
    ok = !aborted, error = NULL,
    nErrors = n_errors,
    truncated = .tr_state$truncated,
    nPlots = .tr_state$page_count,
    envStored = .tr_state$env_store_ok,
    baseline = .tr_state$baseline,
    parseSpans = .tr_state$parse_spans,
    steps = .tr_state$steps
  ))
  .tr_state$json <- json
  json
}

.tr_last_json <- function() .tr_state$json

.tr_json <- function(x) {
  as.character(jsonlite::toJSON(x, auto_unbox = TRUE, null = "null", na = "null", digits = NA))
}

# ---------------------------------------------------------------------------
# On-demand data windows (paging for big data frames)

.tr_window <- function(obj, row0, nrows, col0, ncols) {
  if (is.data.frame(obj) || is.matrix(obj)) {
    nr <- nrow(obj); nc <- ncol(obj)
    ri <- seq.int(max(1L, row0), min(nr, row0 + nrows - 1L))
    ci <- seq.int(max(1L, col0), min(nc, col0 + ncols - 1L))
    if (!length(ri) || !length(ci)) return(list(kind = "empty"))
    cols <- vector("list", length(ci)); cells <- vector("list", length(ci))
    nms <- colnames(obj)
    for (jj in seq_along(ci)) {
      j <- ci[jj]
      col <- if (is.data.frame(obj)) obj[[j]] else obj[, j]
      cols[[jj]] <- list(
        name = if (is.null(nms)) paste0("V", j) else nms[j],
        type = .tr_col_type(col))
      cells[[jj]] <- .tr_fmt_vec(col[ri], length(ri))
    }
    return(list(kind = "window", row0 = ri[1], col0 = ci[1],
                nrow = nr, ncol = nc, cols = cols, cells = cells))
  }
  if (is.atomic(obj)) {
    n <- length(obj)
    ri <- seq.int(max(1L, row0), min(n, row0 + nrows - 1L))
    if (!length(ri)) return(list(kind = "empty"))
    return(list(kind = "vwindow", row0 = ri[1], length = n,
                values = .tr_fmt_vec(obj[ri], length(ri))))
  }
  list(kind = "unsupported")
}

.tr_page <- function(step, name, row0, nrows, col0, ncols) {
  obj <- NULL; src <- "none"
  se <- .tr_state$step_envs[[as.character(step)]]
  if (!is.null(se) && !is.null(se[[name]])) {
    obj <- se[[name]]; src <- "step"
  } else if (exists(name, envir = .tr_state$user_env, inherits = FALSE)) {
    obj <- get(name, envir = .tr_state$user_env, inherits = FALSE); src <- "final"
  }
  if (is.null(obj)) return(.tr_json(list(kind = "missing")))
  w <- .tr_window(obj, row0, nrows, col0, ncols)
  w$source <- src
  .tr_json(w)
}

.tr_pipe_page <- function(store_id, row0, nrows, col0, ncols) {
  if (store_id < 1 || store_id > length(.tr_state$pipe_vals))
    return(.tr_json(list(kind = "missing")))
  w <- .tr_window(.tr_state$pipe_vals[[store_id]], row0, nrows, col0, ncols)
  w$source <- "pipe"
  .tr_json(w)
}

.tr_run_file <- function(path, step_loops = TRUE, stop_on_error = FALSE, max_steps = 1000L,
                         fresh_env = TRUE) {
  con <- file(path, encoding = "UTF-8")
  code <- paste(readLines(con, warn = FALSE), collapse = "\n")
  close(con)
  .tr_run(code, step_loops, stop_on_error, max_steps, fresh_env)
}

# ---------------------------------------------------------------------------
# Click-to-inspect: guard-railed re-evaluation of an arbitrary sub-expression
# in the environment as of a given step, optionally layered with the current
# pipe/chain intermediate value as a data mask (so `factor(cyl)` inside
# mutate() resolves against the piped data frame).

.tr_SIDE_EFFECT_HEADS <- c(
  "install.packages", "write.csv", "write.table", "writeLines", "write",
  "save", "saveRDS", "save.image", "file.remove", "unlink", "file.rename",
  "rm", "set.seed", "library", "require", "source", "sink", "assign", "Sys.sleep",
  "<-", "<<-", "=", "->", "->>", "system", "system2", "quit", "q",
  "download.file", "Sys.setenv", "setwd", "dev.off", "options"
)

.tr_RANDOM_HEADS <- c(
  "rnorm", "runif", "sample", "sample.int", "rbinom", "rpois", "rexp",
  "rgamma", "rbeta", "rt", "rchisq", "rcauchy", "rlnorm", "rmultinom",
  "rhyper", "rgeom", "rweibull"
)

.tr_call_head_name <- function(e) {
  if (!is.call(e)) return(NULL)
  h <- e[[1]]
  if (is.symbol(h)) return(as.character(h))
  if (is.call(h) && is.symbol(h[[1]]) && as.character(h[[1]]) %in% c("::", ":::"))
    return(as.character(h[[3]]))
  NULL
}

.tr_ast_has_heads <- function(e, heads, depth = 0L) {
  if (depth > 12L || !is.call(e)) return(FALSE)
  h <- .tr_call_head_name(e)
  if (!is.null(h) && h %in% heads) return(TRUE)
  for (i in seq_along(e)) {
    part <- tryCatch(e[[i]], error = function(err) NULL)
    if (is.call(part) && .tr_ast_has_heads(part, heads, depth + 1L)) return(TRUE)
  }
  FALSE
}

.tr_summary_line <- function(v) {
  tryCatch({
    if (is.null(v)) return("NULL")
    lens <- .tr_lens(v)
    if (!is.null(lens)) return(lens$short)
    if (is.data.frame(v)) return(sprintf("%s %d × %d", class(v)[1], nrow(v), ncol(v)))
    if (is.matrix(v)) return(sprintf("matrix %d × %d", nrow(v), ncol(v)))
    if (is.factor(v)) return(sprintf("factor[%d] · %d levels", length(v), nlevels(v)))
    if (is.atomic(v)) {
      vals <- paste(.tr_fmt_vec(v, 4L), collapse = ", ")
      if (length(v) == 1) return(vals)
      return(sprintf("%s[%d] %s%s", .tr_col_type(v), length(v), vals,
                     if (length(v) > 4) ", …" else ""))
    }
    if (is.function(v)) return(.tr_deparse(args(v), 50L))
    sprintf("<%s>", class(v)[1])
  }, error = function(e) "?")
}

.tr_index_title <- function(pkg, name) {
  if (is.null(pkg) || !nzchar(pkg)) return(NULL)
  cache <- .tr_state$index_cache
  if (is.null(cache)) {
    cache <- new.env(parent = emptyenv())
    .tr_state$index_cache <- cache
  }
  tab <- cache[[pkg]]
  if (is.null(tab)) {
    tab <- tryCatch({
      f <- system.file("INDEX", package = pkg)
      if (!nzchar(f)) list()
      else {
        lines <- readLines(f, warn = FALSE)
        out <- list(); cur <- NULL
        for (ln in lines) {
          m <- regmatches(ln, regexec("^(\\S+)\\s+(.*)$", ln))[[1]]
          if (length(m) == 3) {
            cur <- m[2]
            out[[cur]] <- m[3]
          } else if (!is.null(cur) && grepl("^\\s+\\S", ln)) {
            out[[cur]] <- paste(out[[cur]], trimws(ln))
          }
        }
        out
      }
    }, error = function(e) list())
    cache[[pkg]] <- tab
  }
  title <- tab[[name]]
  if (is.null(title)) NULL else title
}

.tr_fn_info <- function(name, env = .tr_state$user_env) {
  if (is.null(name)) return(NULL)
  f <- tryCatch(get(name, envir = env, mode = "function"),
                error = function(e) NULL)
  if (is.null(f)) return(NULL)
  pkg <- tryCatch({
    e <- environment(f)
    if (is.null(e)) "base" else {
      nm <- environmentName(topenv(e))
      if (nm %in% c("R_GlobalEnv", "")) "user" else sub("^namespace:", "", nm)
    }
  }, error = function(e) NULL)
  sig <- tryCatch({
    s <- paste(utils::head(deparse(args(f)), 3), collapse = " ")
    trimws(sub("\\s*NULL\\s*$", "", s))
  }, error = function(e) NULL)
  title <- if (!is.null(pkg) && !pkg %in% c("user", "base")) .tr_index_title(pkg, name)
           else if (identical(pkg, "base")) .tr_index_title("base", name)
           else NULL
  list(name = name, pkg = pkg, sig = sig, title = title)
}

.tr_step_env_for <- function(step) {
  se <- .tr_state$step_envs[[as.character(step)]]
  if (!is.null(se)) list2env(se, parent = globalenv()) else .tr_state$user_env
}

.tr_inspect <- function(step, src, pipe_store_id = NULL) {
  res <- list(ok = FALSE, source = src)
  expr <- tryCatch(parse(text = src, keep.source = FALSE)[[1]],
                   error = function(e) NULL)
  if (is.null(expr)) {
    res$error <- "not a complete expression"
    return(res)
  }
  head_nm <- .tr_call_head_name(expr)
  if (!is.null(head_nm)) res$fn <- .tr_fn_info(head_nm)
  if (is.symbol(expr)) res$isSymbol <- TRUE

  blocked <- (!is.null(head_nm) && head_nm %in% .tr_SIDE_EFFECT_HEADS) ||
    (is.call(expr) && is.symbol(expr[[1]]) &&
       as.character(expr[[1]]) %in% c("<-", "<<-", "=", "->", "->>"))
  if (blocked) {
    res$note <- "side-effect"
    res$ok <- TRUE
    return(res)
  }

  env0 <- .tr_step_env_for(step)
  ev_env <- new.env(parent = env0)
  mask <- NULL
  if (!is.null(pipe_store_id) && pipe_store_id >= 1 &&
      pipe_store_id <= length(.tr_state$pipe_vals)) {
    pv <- .tr_state$pipe_vals[[pipe_store_id]]
    if (is.data.frame(pv)) mask <- pv
  }

  res$resampled <- .tr_ast_has_heads(expr, .tr_RANDOM_HEADS)

  # guards: time limit + null graphics device (so nothing draws on screen)
  grDevices::pdf(NULL)
  gdev <- grDevices::dev.cur()
  on.exit({
    if (gdev %in% grDevices::dev.list()) grDevices::dev.off(gdev)
  }, add = TRUE)
  setTimeLimit(cpu = 3, elapsed = 3, transient = TRUE)
  on.exit(setTimeLimit(cpu = Inf, elapsed = Inf), add = TRUE)

  eval_one <- function(e) {
    if (is.null(mask)) eval(e, envir = ev_env)
    else eval(e, envir = mask, enclos = ev_env)
  }

  err <- NULL
  val <- withCallingHandlers(
    tryCatch(eval_one(expr), error = function(e) { err <<- conditionMessage(e); NULL }),
    warning = function(w) invokeRestart("muffleWarning"),
    message = function(m) invokeRestart("muffleMessage")
  )
  if (!is.null(err)) {
    res$error <- err
    res$ok <- TRUE
    return(res)
  }
  res$ok <- TRUE
  res$value <- .tr_preview("(selection)", val)
  if (is.call(expr) && length(expr) > 1L) {
    argl <- as.list(expr)[-1]
    nms <- names(argl)
    n <- min(length(argl), 8L)
    args_out <- list()
    for (i in seq_len(n)) {
      a <- argl[[i]]
      if (identical(a, quote(expr = ))) next  # empty arg
      s <- NULL
      averr <- NULL
      av <- tryCatch(eval_one(a), error = function(e) { averr <<- TRUE; NULL })
      s <- if (is.null(averr)) .tr_summary_line(av) else "?"
      args_out[[length(args_out) + 1L]] <- list(
        name = if (!is.null(nms) && nzchar(nms[i])) nms[i] else "",
        code = .tr_deparse(a, 40L),
        summary = s
      )
    }
    if (length(args_out)) res$args <- args_out
  }
  res
}

.tr_inspect_json <- function(step, src, pipe_store_id = NULL) {
  .tr_json(tryCatch(.tr_inspect(step, src, pipe_store_id),
                    error = function(e) list(ok = FALSE, error = conditionMessage(e))))
}

.tr_fn_info_json <- function(name) {
  .tr_json(tryCatch(.tr_fn_info(name),
                    error = function(e) NULL))
}

.tr_version <- function() "2"
