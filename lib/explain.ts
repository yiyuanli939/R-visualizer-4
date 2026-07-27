import type { Lang } from "./i18n";
import type { ObjPreview, TraceStep } from "./webr/types";

/**
 * Rule-based, bilingual plain-language explanation of what a trace step did —
 * aimed at readers who are not R experts. Built entirely from runtime facts
 * (verb, dims before/after, columns added, variables touched, loop state).
 */

type V = { en: string; zh: string };

const VERBS: Record<string, V> = {
  filter: { en: "Keeps only the rows that match the condition", zh: "筛选行：只保留满足条件的行" },
  subset: { en: "Keeps only the rows that match the condition", zh: "筛选行：只保留满足条件的行" },
  drop_na: { en: "Removes rows containing missing values (NA)", zh: "删除含缺失值 (NA) 的行" },
  "na.omit": { en: "Removes rows containing missing values (NA)", zh: "删除含缺失值 (NA) 的行" },
  distinct: { en: "Removes duplicate rows", zh: "去除重复行" },
  mutate: { en: "Adds or modifies columns", zh: "新增或修改列" },
  transmute: { en: "Computes new columns and drops the rest", zh: "计算新列并丢弃其余列" },
  transform: { en: "Adds or modifies columns", zh: "新增或修改列" },
  select: { en: "Picks a subset of columns", zh: "挑选部分列" },
  rename: { en: "Renames columns", zh: "重命名列" },
  relocate: { en: "Reorders columns", zh: "调整列的顺序" },
  group_by: {
    en: "Marks the data as grouped — later summaries run per group (data itself unchanged)",
    zh: "把数据标记为按组处理——之后的汇总会按组计算（数据本身不变）",
  },
  ungroup: { en: "Removes the grouping marks", zh: "取消分组标记" },
  summarise: { en: "Collapses each group into one summary row", zh: "汇总：把每组压缩成一行统计结果" },
  summarize: { en: "Collapses each group into one summary row", zh: "汇总：把每组压缩成一行统计结果" },
  summarize_at: { en: "Collapses each group into one summary row", zh: "汇总：把每组压缩成一行统计结果" },
  summarise_at: { en: "Collapses each group into one summary row", zh: "汇总：把每组压缩成一行统计结果" },
  aggregate: { en: "Collapses groups into summary rows", zh: "按组聚合出统计结果" },
  count: { en: "Counts how many rows fall in each group", zh: "统计每组的行数" },
  tally: { en: "Counts rows", zh: "计数" },
  arrange: { en: "Sorts the rows (row count unchanged)", zh: "对行排序（行数不变）" },
  head: { en: "Takes the first rows", zh: "取前几行" },
  tail: { en: "Takes the last rows", zh: "取最后几行" },
  slice: { en: "Picks rows by position", zh: "按位置挑选行" },
  slice_head: { en: "Takes the first rows", zh: "取前几行" },
  slice_max: { en: "Takes the rows with the largest values", zh: "取数值最大的几行" },
  slice_min: { en: "Takes the rows with the smallest values", zh: "取数值最小的几行" },
  left_join: { en: "Merges in columns from another table (keeping all left rows)", zh: "左连接：并入另一张表的列（保留左表所有行）" },
  right_join: { en: "Merges in columns from another table (keeping all right rows)", zh: "右连接：并入另一张表的列（保留右表所有行）" },
  inner_join: { en: "Merges two tables, keeping only rows matched in both", zh: "内连接：只保留两表都匹配的行" },
  full_join: { en: "Merges two tables, keeping all rows from both", zh: "全连接：保留两表的全部行" },
  anti_join: { en: "Keeps rows with no match in the other table", zh: "反连接:保留在另一表中找不到匹配的行" },
  semi_join: { en: "Keeps rows that have a match in the other table", zh: "半连接：保留在另一表中有匹配的行" },
  merge: { en: "Merges two tables by common columns", zh: "按共同列合并两张表" },
  pivot_longer: { en: "Reshapes wide → long: turns columns into rows", zh: "宽表变长表：把多列折叠成行" },
  pivot_wider: { en: "Reshapes long → wide: spreads rows into columns", zh: "长表变宽表：把行展开成列" },
  bind_rows: { en: "Stacks tables on top of each other", zh: "按行拼接多张表" },
  bind_cols: { en: "Places tables side by side", zh: "按列拼接多张表" },
  nrow: { en: "Returns the number of rows", zh: "返回行数" },
  glimpse: { en: "Prints a compact preview of the data", zh: "打印数据的紧凑预览" },
  print: { en: "Prints to the console", zh: "打印到控制台" },
  summary: { en: "Prints summary statistics", zh: "打印汇总统计" },
  str: { en: "Prints the data's structure", zh: "打印数据结构" },
  mean: { en: "Computes the average", zh: "计算平均值" },
  median: { en: "Computes the median", zh: "计算中位数" },
  sum: { en: "Computes the total", zh: "求和" },
  sd: { en: "Computes the standard deviation", zh: "计算标准差" },
  var: { en: "Computes the variance", zh: "计算方差" },
  quantile: { en: "Computes quantiles (cut points of the distribution)", zh: "计算分位数（分布的切分点）" },
  cor: { en: "Computes the correlation", zh: "计算相关系数" },
  table: { en: "Builds a frequency table", zh: "生成频数表" },
  lm: {
    en: "Fits a linear regression — models how the outcome changes with the predictors",
    zh: "拟合线性回归——刻画结果变量如何随预测变量变化",
  },
  glm: {
    en: "Fits a generalized linear model (e.g. logistic regression)",
    zh: "拟合广义线性模型（如逻辑回归）",
  },
  "t.test": { en: "Runs a t-test comparing group means", zh: "t 检验：比较组间均值差异" },
  "chisq.test": { en: "Runs a chi-squared test of association", zh: "卡方检验：检验两个分类变量是否相关" },
  "prop.test": { en: "Tests differences in proportions", zh: "比例检验" },
  anova: { en: "Analysis of variance across the fitted models", zh: "方差分析" },
  aov: { en: "Fits an analysis-of-variance model", zh: "拟合方差分析模型" },
  predict: { en: "Computes model predictions", zh: "用模型计算预测值" },
  residuals: { en: "Extracts model residuals (actual − predicted)", zh: "提取模型残差（实际值 − 预测值）" },
  coef: { en: "Extracts the fitted coefficients", zh: "提取拟合系数" },
  read_csv: { en: "Reads a CSV data file", zh: "读入 CSV 数据文件" },
  "read.csv": { en: "Reads a CSV data file", zh: "读入 CSV 数据文件" },
  read_dta: { en: "Reads a Stata data file", zh: "读入 Stata 数据文件" },
  read_rds: { en: "Reads a saved R object", zh: "读入保存的 R 对象" },
  load: { en: "Loads saved R objects into the workspace", zh: "载入保存的 R 工作区对象" },
  data: { en: "Loads a built-in / packaged dataset", zh: "载入内置或包内数据集" },
  library: { en: "Loads an extension package", zh: "加载扩展包" },
  require: { en: "Loads an extension package", zh: "加载扩展包" },
  set_seed: { en: "Fixes the random seed so results are reproducible", zh: "固定随机种子，保证结果可复现" },
  "set.seed": { en: "Fixes the random seed so results are reproducible", zh: "固定随机种子，保证结果可复现" },
  ggplot: { en: "Starts building a ggplot chart", zh: "开始构建 ggplot 图形" },
  plot: { en: "Draws a chart", zh: "绘制图形" },
  hist: { en: "Draws a histogram of the distribution", zh: "绘制直方图（分布形态）" },
  boxplot: { en: "Draws a boxplot comparing distributions", zh: "绘制箱线图（比较分布）" },
  barplot: { en: "Draws a bar chart", zh: "绘制条形图" },
  sample: { en: "Draws a random sample", zh: "随机抽样" },
  rnorm: { en: "Generates random numbers from a normal distribution", zh: "从正态分布生成随机数" },
  runif: { en: "Generates uniform random numbers", zh: "生成均匀分布随机数" },
  factor: { en: "Converts values into categories", zh: "把取值转换为分类变量" },
  "as.factor": { en: "Converts values into categories", zh: "把取值转换为分类变量" },
  ifelse: { en: "Chooses values element-by-element based on a condition", zh: "按条件逐个选择取值" },
  if_else: { en: "Chooses values element-by-element based on a condition", zh: "按条件逐个选择取值" },
  paste: { en: "Glues text together", zh: "拼接文本" },
  paste0: { en: "Glues text together", zh: "拼接文本" },
};

function dims(v?: ObjPreview | null): [number, number] | null {
  if (v && (v.kind === "data.frame" || v.kind === "matrix") && v.nrow != null && v.ncol != null)
    return [v.nrow, v.ncol];
  return null;
}

function fmtDelta(prev: [number, number] | null, cur: [number, number] | null, lang: Lang): string {
  if (!cur) return "";
  if (!prev) return lang === "zh" ? ` · ${cur[0]} 行 × ${cur[1]} 列` : ` · ${cur[0]} × ${cur[1]}`;
  const parts: string[] = [];
  if (prev[0] !== cur[0]) {
    const d = cur[0] - prev[0];
    parts.push(
      lang === "zh"
        ? `${prev[0]} → ${cur[0]} 行（${d > 0 ? "+" : ""}${d}）`
        : `${prev[0]} → ${cur[0]} rows (${d > 0 ? "+" : ""}${d})`,
    );
  }
  if (prev[1] !== cur[1]) {
    const d = cur[1] - prev[1];
    parts.push(
      lang === "zh"
        ? `${prev[1]} → ${cur[1]} 列（${d > 0 ? "+" : ""}${d}）`
        : `${prev[1]} → ${cur[1]} cols (${d > 0 ? "+" : ""}${d})`,
    );
  }
  if (!parts.length)
    parts.push(lang === "zh" ? `${cur[0]} 行 × ${cur[1]} 列不变` : `${cur[0]} × ${cur[1]} unchanged`);
  return " · " + parts.join(lang === "zh" ? "，" : ", ");
}

function newColumns(prev?: ObjPreview | null, cur?: ObjPreview | null): string[] {
  if (!prev?.cols || !cur?.cols) return [];
  const old = new Set(prev.cols.map((c) => c.name));
  return cur.cols.filter((c) => !old.has(c.name)).map((c) => c.name);
}

function verbOf(label: string): string {
  const m = label.match(/^\s*([A-Za-z_][A-Za-z0-9._]*(?:::)?[A-Za-z0-9._]*)\s*\(/);
  if (!m) return "";
  return m[1].split("::").pop() ?? "";
}

function kindLabel(o: ObjPreview, lang: Lang): string {
  switch (o.kind) {
    case "data.frame":
      return lang === "zh" ? `数据框 ${o.nrow} 行 × ${o.ncol} 列` : `data frame, ${o.nrow} × ${o.ncol}`;
    case "matrix":
      return lang === "zh" ? `矩阵 ${o.nrow} × ${o.ncol}` : `matrix, ${o.nrow} × ${o.ncol}`;
    case "vector":
      return lang === "zh" ? `${o.vtype ?? ""} 向量，长度 ${o.length}` : `${o.vtype ?? ""} vector of length ${o.length}`;
    case "factor":
      return lang === "zh" ? `分类变量，${o.nlevels} 个水平` : `factor with ${o.nlevels} levels`;
    case "list":
      return lang === "zh" ? `列表，${o.length} 个元素` : `list of ${o.length}`;
    case "function":
      return lang === "zh" ? "自定义函数" : "a function";
    case "object":
      return o.summary ?? (Array.isArray(o.cls) ? o.cls[0] : String(o.cls ?? ""));
    default:
      return Array.isArray(o.cls) ? o.cls[0] : String(o.cls ?? "");
  }
}

/** Grammar-of-graphics `+` chain links: layer/scale/theme composition. */
function explainPlusLink(step: TraceStep, lang: Lang): string {
  const zh = lang === "zh";
  const pipe = step.pipe!;
  const label = pipe.label ?? "";
  const verb = verbOf(label);
  const objSummary = pipe.value?.summary ? ` · ${pipe.value.summary}` : "";
  if (pipe.index === 1) {
    return zh
      ? `图形语法起点：${label} 创建画布，绑定数据与美学映射；后面每个 + 往图上叠加一个组件。`
      : `Grammar-of-graphics start: ${label} builds the canvas, binding data and aesthetics; each following + adds one component.`;
  }
  let what: string | null = null;
  const gm = verb.match(/^geom_(\w+)$/);
  const sm = verb.match(/^stat_(\w+)$/);
  const sc = verb.match(/^scale_(\w+)/);
  const co = verb.match(/^coord_(\w+)$/);
  const fa = verb.match(/^facet_(\w+)$/);
  if (gm) what = zh ? `添加「${gm[1]}」几何图层` : `adds a "${gm[1]}" geometry layer`;
  else if (sm) what = zh ? `添加「${sm[1]}」统计变换图层` : `adds a "${sm[1]}" statistical layer`;
  else if (sc) what = zh ? `设置标度（${sc[1]}）：控制数据如何映射到视觉属性` : `sets a scale (${sc[1]}) — how data maps to visuals`;
  else if (co) what = zh ? `切换坐标系（${co[1]}）` : `switches the coordinate system (${co[1]})`;
  else if (fa) what = zh ? `按变量分面成多个小图` : `facets into small multiples`;
  else if (verb === "labs") what = zh ? "设置标题与轴标签" : "sets the title and axis labels";
  else if (verb === "guides") what = zh ? "调整图例" : "adjusts the legends";
  else if (verb.startsWith("theme")) what = zh ? "调整主题外观（非数据元素）" : "styles non-data elements (theme)";
  else if (verb === "aes") what = zh ? "追加美学映射" : "adds aesthetic mappings";
  else if (verb === "xlim" || verb === "ylim" || verb === "lims") what = zh ? "限定坐标范围" : "limits the axis range";
  if (what) return `${verb}() — ${what}${objSummary}`;
  return zh ? `+ ${label} 叠加到图形对象上${objSummary}` : `+ ${label} composed onto the plot object${objSummary}`;
}

export function explainStep(
  step: TraceStep,
  prevStep: TraceStep | undefined,
  codeLines: string[],
  lang: Lang,
): string | null {
  const zh = lang === "zh";

  if (step.kind === "loop-fold") {
    return zh
      ? `循环的剩余迭代已折叠记录（${step.note ?? ""}），代码仍完整执行。`
      : `Remaining loop iterations were folded (${step.note ?? ""}); the code still ran fully.`;
  }

  // errors first — tell the reader what happened and that execution moved on
  if (step.errorMsg) {
    return zh
      ? `此步报错：${step.errorMsg} —— 该语句被跳过，继续执行后面的代码。`
      : `This step failed: ${step.errorMsg} — the statement was skipped and execution continued.`;
  }

  // pipe steps: verb + concrete before/after facts
  if (step.pipe) {
    const label = step.pipe.label ?? "";
    if (step.pipe.op === "+") return explainPlusLink(step, lang);
    if (step.pipe.index === 1) {
      const d = dims(step.pipe.value);
      const what = d
        ? zh
          ? `管道起点：从 ${label} 开始，${d[0]} 行 × ${d[1]} 列`
          : `Pipeline start: begins with ${label}, ${d[0]} × ${d[1]}`
        : zh
          ? `管道起点：从 ${label} 开始`
          : `Pipeline start: begins with ${label}`;
      return what + (zh ? `。数据将依次流过 ${step.pipe.total - 1} 个处理环节。` : `. The data flows through ${step.pipe.total - 1} transformation${step.pipe.total > 2 ? "s" : ""}.`);
    }
    const verb = verbOf(label);
    const base = VERBS[verb];
    const prevVal = prevStep?.pipe?.value ?? null;
    const delta = fmtDelta(dims(prevVal), dims(step.pipe.value), lang);
    const cols = newColumns(prevVal, step.pipe.value);
    const colNote = cols.length
      ? zh
        ? `，新列：${cols.join(", ")}`
        : `, new column${cols.length > 1 ? "s" : ""}: ${cols.join(", ")}`
      : "";
    if (base) return `${verb}() — ${zh ? base.zh : base.en}${delta}${colNote}`;
    return zh ? `执行 ${label}${delta}${colNote}` : `Applies ${label}${delta}${colNote}`;
  }

  // plain statements: use the source text + env effects
  const text =
    step.line1 >= 1 && step.line1 <= codeLines.length
      ? codeLines.slice(step.line1 - 1, Math.min(step.line2, codeLines.length)).join(" ").trim()
      : "";
  const added = step.env.added;
  const changed = step.env.changed;

  const asn = text.match(/^\s*([A-Za-z._][A-Za-z0-9._]*)\s*(<-|=)\s*([\s\S]*)$/);
  const rhs = asn ? asn[3] : text;
  const verb = verbOf(rhs);
  const base = VERBS[verb];

  const target = asn?.[1];
  const targetObj = target ? step.env.objs.find((o) => o.name === target) : undefined;

  const pieces: string[] = [];
  if (base) pieces.push(`${verb}() — ${zh ? base.zh : base.en}`);

  if (target && targetObj) {
    const isNew = added.includes(target);
    pieces.push(
      zh
        ? `${isNew ? "创建" : "更新"}变量 ${target}（${kindLabel(targetObj, lang)}）`
        : `${isNew ? "Creates" : "Updates"} variable ${target} (${kindLabel(targetObj, lang)})`,
    );
  } else if (!base && (added.length || changed.length)) {
    const names = [...added, ...changed];
    pieces.push(zh ? `影响变量：${names.join(", ")}` : `Touches variables: ${names.join(", ")}`);
  }

  if (step.plots.length)
    pieces.push(zh ? "生成了一张图（见图形面板）" : "produced a plot (see Plots panel)");
  if (!pieces.length && step.stdout.length)
    pieces.push(zh ? "把结果打印到控制台（见控制台面板）" : "prints its result to the console (see Console panel)");

  if (step.loop?.length) {
    const lf = step.loop[step.loop.length - 1];
    pieces.push(
      zh
        ? `当前在循环第 ${lf.iter} 次迭代${lf.var ? `（${lf.var} = ${lf.value}）` : ""}`
        : `inside loop iteration ${lf.iter}${lf.var ? ` (${lf.var} = ${lf.value})` : ""}`,
    );
  }

  if (!pieces.length) return null;
  return pieces.join(zh ? "；" : "; ") + (zh ? "。" : ".");
}
