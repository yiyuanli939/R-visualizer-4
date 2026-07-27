# OOP visualization mechanism tests: `+` chain splitting, generic object
# trees across S3/S4/R6/S7, data-mask inspection, and evaluation guards.
# Run from the repo root:  Rscript tests/test-oop.R
source("public/trace.R")
`%||%` <- function(a, b) if (is.null(a)) b else a

pass <- 0L; fail <- 0L
check <- function(label, cond) {
  if (isTRUE(cond)) { pass <<- pass + 1L; cat("  ok:", label, "\n") }
  else { fail <<- fail + 1L; cat("  FAIL:", label, "\n") }
}

## 1. the user's exact example: pipe + ggplot `+` chain -----------------------
code <- paste(collapse = "\n", c(
  'library(dplyr)', 'library(ggplot2)',
  'cars <- mtcars |>',
  '  mutate(cyl = factor(cyl))',
  '',
  'p <- ggplot(cars, aes(wt, mpg, color = cyl)) +',
  '  geom_point(size = 3) +',
  '  geom_smooth(method = "lm", se = FALSE) +',
  '  labs(title = "Fuel efficiency vs weight",',
  '       x = "Weight (1000 lbs)", y = "MPG")'
))
r <- jsonlite::fromJSON(.tr_run(code), simplifyVector = FALSE)
plus_steps <- Filter(function(s) !is.null(s$pipe) && identical(s$pipe$op, "+"), r$steps)
cat("== ggplot + chain ==\n")
check("4 chain steps recorded", length(plus_steps) == 4)
check("labels are layer calls",
      grepl("^geom_point", plus_steps[[2]]$pipe$label) &&
      grepl("^labs", plus_steps[[4]]$pipe$label))
v2 <- plus_steps[[2]]$pipe$value
check("chain value is object kind", identical(v2$kind, "object"))
check("lens sees 1 layer at geom_point", grepl("1 layer", v2$summary %||% ""))
v3 <- plus_steps[[3]]$pipe$value
check("lens sees 2 layers at geom_smooth", grepl("2 layers", v3$summary %||% ""))
check("lens names geoms", grepl("point", v3$summary %||% "") && grepl("smooth", v3$summary %||% ""))
tree <- v3$tree
kids <- vapply(tree$children %||% list(), function(k) k$name, character(1))
cat("   S7 prop children:", paste(utils::head(kids, 12), collapse = " "), "\n")
check("tree is S7 with @layers child", identical(tree$type, "s7") && "@layers" %in% kids)
check("p recorded in env at last step",
      any(vapply(r$steps[[length(r$steps)]]$env$objs, function(o) o$name == "p", logical(1))))
check("no plot pages drawn by chain", r$nPlots == 0)
check("parseSpans shipped", length(r$parseSpans %||% list()) > 0)

## 2. arithmetic is untouched -------------------------------------------------
r2 <- jsonlite::fromJSON(.tr_run("x <- 1 + 2 + 3\n1 + 2 + 3"), simplifyVector = FALSE)
cat("== arithmetic ==\n")
check("2 plain steps, no chain", length(r2$steps) == 2 &&
      !any(vapply(r2$steps, function(s) !is.null(s$pipe), logical(1))))
check("bare sum auto-printed", any(grepl("\\[1\\] 6", unlist(r2$steps[[2]]$stdout))))

## 3. data-mask inspection (factor(cyl) inside mutate context) ---------------
## NOTE: .tr_inspect works on the CURRENT engine state, so re-run the code
## right before inspecting (later sections each run their own traces).
cat("== inspect with data mask ==\n")
r <- jsonlite::fromJSON(.tr_run(code), simplifyVector = FALSE)
mut_step <- Filter(function(s) !is.null(s$pipe) && grepl("^mutate", s$pipe$label %||% ""), r$steps)[[1]]
ins <- .tr_inspect(mut_step$i, "factor(cyl)", mut_step$pipe$storeId)
check("mask eval ok", isTRUE(ins$ok) && is.null(ins$error))
check("factor value", identical(ins$value$kind, "factor") && ins$value$length == 32)
check("fn info resolves factor()", identical(ins$fn$name, "factor") && identical(ins$fn$pkg, "base"))
ins_aes <- .tr_inspect(mut_step$i, "aes(wt, mpg, color = cyl)")
check("aes evaluates to object", isTRUE(ins_aes$ok) && identical(ins_aes$value$kind, "object"))
check("aes fn info from ggplot2", identical(ins_aes$fn$pkg, "ggplot2"))
cat("   aes INDEX title:", ins_aes$fn$title %||% "(none)", "\n")
check("args evaluated", length(ins_aes$args %||% list()) >= 2)

## 4. object trees across systems --------------------------------------------
cat("== object systems ==\n")
setClass("TPoint", representation(x = "numeric", y = "numeric"))
r4 <- jsonlite::fromJSON(.tr_run('pt <- new("TPoint", x = 1, y = 2)'), simplifyVector = FALSE)
o4 <- r4$steps[[1]]$env$objs[[1]]
k4 <- vapply(o4$tree$children %||% list(), function(k) k$name, character(1))
check("S4 slots visible", identical(o4$tree$type, "s4") && all(c("@x", "@y") %in% k4))

if (requireNamespace("R6", quietly = TRUE)) {
  r6 <- jsonlite::fromJSON(.tr_run(paste(collapse = "\n", c(
    'library(R6)',
    'Counter <- R6Class("Counter", public = list(',
    '  n = 0,',
    '  add = function() { self$n <- self$n + 1; invisible(self) }',
    '))',
    'cnt <- Counter$new()',
    'cnt$add()$add()'
  ))), simplifyVector = FALSE)
  oc <- Filter(function(o) o$name == "cnt",
               r6$steps[[length(r6$steps)]]$env$objs)
  if (!length(oc)) {
    # cnt unchanged in last step; find it in any step
    for (s in rev(r6$steps)) {
      oc <- Filter(function(o) o$name == "cnt", s$env$objs)
      if (length(oc)) break
    }
  }
  kc <- vapply(oc[[1]]$tree$children %||% list(), function(k) k$name, character(1))
  check("R6 fields+methods visible", identical(oc[[1]]$tree$type, "r6") &&
        "$n" %in% kc && "add()" %in% kc)
} else cat("  (R6 not installed, skipped)\n")

rlm <- jsonlite::fromJSON(.tr_run("fit <- lm(mpg ~ wt, data = mtcars)"), simplifyVector = FALSE)
olm <- rlm$steps[[1]]$env$objs[[1]]
check("lm lens", grepl("mpg ~ wt", olm$summary %||% "") && grepl("2 coef", olm$summary %||% ""))
check("lm tree children include $coefficients",
      "$coefficients" %in% vapply(olm$tree$children %||% list(), function(k) k$name, character(1)))

renv <- jsonlite::fromJSON(.tr_run('e <- new.env(); e$a <- 42; e$b <- "hi"'), simplifyVector = FALSE)
oe <- Filter(function(o) o$name == "e", renv$steps[[length(renv$steps)]]$env$objs)
if (length(oe)) {
  ke <- vapply(oe[[1]]$tree$children %||% list(), function(k) k$name, character(1))
  check("environment tree", identical(oe[[1]]$tree$type, "env") && all(c("$a", "$b") %in% ke))
} else check("environment tree", FALSE)

## 5. guards ------------------------------------------------------------------
cat("== guards ==\n")
invisible(.tr_run("g_x <- 10"))
b1 <- .tr_inspect(1, 'write.csv(mtcars, "no.csv")')
check("side-effect head blocked", isTRUE(b1$ok) && identical(b1$note, "side-effect"))
check("blocked file not written", !file.exists("no.csv"))
b2 <- .tr_inspect(1, "while (TRUE) 1")
check("timeout guard trips", !is.null(b2$error) && grepl("time|elapsed|limit", b2$error, ignore.case = TRUE))
b2b <- .tr_inspect(1, "Sys.sleep(10)")
check("Sys.sleep blocked as side-effect", identical(b2b$note, "side-effect"))
b3 <- .tr_inspect(1, "rnorm(3)")
check("resampled flagged", isTRUE(b3$resampled) && identical(b3$value$kind, "vector"))
b4 <- .tr_inspect(1, "g_x * 2")
check("step env resolution", identical(b4$value$values[[1]] %||% b4$value$values, "20"))
b5 <- .tr_inspect(1, "plot(1:3)")
check("inspect never draws a page", isTRUE(b5$ok))

cat(sprintf("\n%d passed, %d failed\n", pass, fail))
if (fail > 0) quit(status = 1)
