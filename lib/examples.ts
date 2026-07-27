export interface Example {
  id: string;
  name: { en: string; zh: string };
  code: string;
}

export const EXAMPLES: Example[] = [
  {
    id: "dplyr",
    name: { en: "dplyr pipeline", zh: "dplyr 管道" },
    code: `library(dplyr)

result <- starwars |>
  filter(!is.na(mass), !is.na(height)) |>
  mutate(bmi = mass / (height / 100)^2) |>
  group_by(species) |>
  summarise(n = n(), mean_bmi = mean(bmi)) |>
  arrange(desc(mean_bmi)) |>
  head(8)

result
`,
  },
  {
    id: "basics",
    name: { en: "R basics", zh: "R 基础" },
    code: `x <- c(2, 4, 6, 8)
total <- sum(x)
avg <- mean(x)

greet <- function(name) {
  paste("Hello,", name)
}
msg <- greet("R visualizer")

squares <- x^2
names(squares) <- paste0("sq", x)
squares
`,
  },
  {
    id: "loop",
    name: { en: "for loop (Fibonacci)", zh: "for 循环（斐波那契）" },
    code: `fib <- c(1, 1)
for (i in 3:10) {
  nxt <- fib[i - 1] + fib[i - 2]
  fib <- c(fib, nxt)
}
fib

total <- 0
for (n in fib) {
  if (n %% 2 == 0) {
    total <- total + n
  }
}
total
`,
  },
  {
    id: "ggplot",
    name: { en: "ggplot2 chart", zh: "ggplot2 绘图" },
    code: `library(dplyr)
library(ggplot2)

cars <- mtcars |>
  mutate(cyl = factor(cyl))

p <- ggplot(cars, aes(wt, mpg, color = cyl)) +
  geom_point(size = 3) +
  geom_smooth(method = "lm", se = FALSE) +
  labs(title = "Fuel efficiency vs weight",
       x = "Weight (1000 lbs)", y = "MPG")

p
`,
  },
  {
    id: "tidyr",
    name: { en: "tidyr reshape", zh: "tidyr 变形" },
    code: `library(tidyr)
library(dplyr)

wide <- tibble(
  student = c("Ana", "Ben", "Chen"),
  math = c(90, 82, 95),
  physics = c(85, 88, 79),
  history = c(78, 91, 86)
)

long <- wide |>
  pivot_longer(-student, names_to = "subject", values_to = "score") |>
  group_by(subject) |>
  mutate(above_avg = score > mean(score)) |>
  ungroup()

long
`,
  },
  {
    id: "csv",
    name: { en: "Read your CSV", zh: "读取上传的 CSV" },
    code: `# Upload a .csv in the Files panel first,
# then replace the file name below.
library(readr)
library(dplyr)

df <- read_csv("your_file.csv")

df |>
  summarise(across(where(is.numeric), mean, na.rm = TRUE))
`,
  },
  {
    id: "oop",
    name: { en: "OOP & references (R6/S4/env)", zh: "OOP 与引用（R6/S4/env）" },
    code: `library(R6)

Account <- R6Class("Account", public = list(
  balance = 0, owner = NULL,
  initialize = function(owner) { self$owner <- owner },
  deposit = function(x) { self$balance <- self$balance + x; invisible(self) }
))

a <- Account$new("Ana")
b <- a            # NOT a copy: b points to the same object
a$deposit(100)    # ...so b$balance changes too

setClass("Point", representation(x = "numeric", y = "numeric"))
pt <- new("Point", x = 1, y = 2)

shared <- new.env()
shared$log <- c("start")
alias <- shared   # same environment, two names

v <- c(3.14, 2.72, 1.41)
d <- head(mtcars, 3)
b$balance
`,
  },
  {
    id: "bigdata",
    name: { en: "Big data frame", zh: "大数据框" },
    code: `big <- as.data.frame(matrix(rnorm(200000), ncol = 200))
big$group <- sample(letters[1:4], nrow(big), replace = TRUE)

agg <- aggregate(V1 ~ group, data = big, FUN = mean)
agg
`,
  },
];
