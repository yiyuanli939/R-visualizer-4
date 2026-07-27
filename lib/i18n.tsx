"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";

export type Lang = "en" | "zh";

const dict = {
  // top bar
  run: ["Visualize", "运行可视化"],
  running: ["Running…", "运行中…"],
  stop: ["Stop", "中止"],
  stepLoops: ["Step into loops", "步进循环内部"],
  continueOnError: ["Continue after errors", "出错后继续"],
  keepWorkspace: ["Keep workspace", "保留工作区"],
  runOptions: ["Run options", "运行选项"],
  backendWebR: ["WebR · browser", "WebR·浏览器"],
  backendLocal: ["Local R", "本地 R"],
  localStart: [
    "Local R not reachable — run this on your machine (needs httpuv + jsonlite):",
    "未连接到本地 R——在你的电脑上运行（需先装 httpuv 和 jsonlite）：",
  ],
  tokenPrompt: ["Paste the token printed by the local backend:", "粘贴本地后端启动时打印的令牌："],
  tokenApply: ["Connect", "连接"],
  retry: ["Retry", "重试"],
  localGuide: ["Local R tutorial", "Local R 使用教程"],
  localGuideShort: ["Tutorial", "教程"],
  copied: ["Copied", "已复制"],
  maxSteps: ["Max steps", "最大步数"],
  errorsChip: ["errors — click to jump", "处错误——点击跳转"],
  examples: ["Examples", "示例"],
  theme: ["Theme", "主题"],
  // engine status
  "st.unloaded": ["R not loaded", "R 未加载"],
  "st.downloading": ["Downloading R runtime…", "正在下载 R 运行时…"],
  "st.starting": ["Starting R…", "正在启动 R…"],
  "st.packages": ["Installing packages…", "正在安装 R 包…"],
  "st.ready": ["R ready", "R 已就绪"],
  "st.running": ["Running", "运行中"],
  "st.error": ["Engine error", "引擎错误"],
  // panels
  code: ["Code", "代码"],
  data: ["Data", "数据"],
  variables: ["Variables", "变量"],
  console: ["Console", "控制台"],
  plots: ["Plots", "图形"],
  files: ["Files", "文件"],
  pipeline: ["Pipeline", "管道"],
  outline: ["Outline", "大纲"],
  memory: ["Memory", "内存图"],
  noOutline: ["Run the code to see a section-by-section outline.", "运行代码后，这里按小节展示脚本大纲。"],
  // stepper
  step: ["Step", "步骤"],
  of: ["of", "/"],
  first: ["First step (Home)", "第一步 (Home)"],
  prev: ["Previous step (←)", "上一步 (←)"],
  next: ["Next step (→)", "下一步 (→)"],
  last: ["Last step (End)", "最后一步 (End)"],
  // data panel
  rows: ["rows", "行"],
  cols: ["cols", "列"],
  showingRows: ["showing first", "预览前"],
  loadMoreRows: ["Load more rows", "加载更多行"],
  loadMoreCols: ["More columns", "更多列"],
  noObject: ["Run your code, then pick a variable to inspect it here.", "运行代码后，点选变量在此查看。"],
  pipeResult: ["pipe result", "管道中间结果"],
  finalStateNote: ["showing final value (step snapshot unavailable)", "显示最终值（该步快照不可用）"],
  emptyDf: ["empty data frame", "空数据框"],
  removedRows: ["Removed rows", "被删除的行"],
  levels: ["levels", "个水平"],
  // variables
  noVars: ["No variables yet — run some code.", "还没有变量——先运行代码。"],
  removed: ["removed", "已移除"],
  fnDef: ["function", "函数"],
  // console
  noOutput: ["No console output up to this step.", "到当前步骤为止没有输出。"],
  // plots
  noPlots: ["No plots up to this step.", "到当前步骤为止没有图形。"],
  download: ["Download PNG", "下载 PNG"],
  close: ["Close", "关闭"],
  // files
  dropHint: [
    "Drop files here or click to upload — .R opens in the editor, data files (.csv, .tsv, .rds, .xlsx…) go to the R working directory.",
    "拖拽或点击上传——.R 文件载入编辑器，数据文件 (.csv、.tsv、.rds、.xlsx…) 存入 R 工作目录。",
  ],
  uploaded: ["In working directory", "已在工作目录"],
  removeFile: ["Remove", "移除"],
  // misc
  truncated: [
    "Trace truncated at 1000 steps; the code still ran to completion.",
    "追踪在 1000 步处截断；代码仍完整执行。",
  ],
  loopFold: ["later iterations folded", "后续迭代已折叠"],
  errorTitle: ["Error", "错误"],
  parseError: ["Parse error", "语法解析错误"],
  loading: ["Loading", "加载中"],
  iter: ["iteration", "迭代"],
  editHint: ["Code changed — visualize again to refresh the trace.", "代码已修改——重新运行以刷新追踪。"],
  tagline: [
    "Step through R code in your browser — every pipe, every loop, every variable.",
    "在浏览器里逐步执行 R 代码——每个管道、每次循环、每个变量。",
  ],
} as const;

export type TKey = keyof typeof dict;

const LangCtx = createContext<{ lang: Lang; setLang: (l: Lang) => void }>({
  lang: "en",
  setLang: () => {},
});

export function LangProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>("en");
  useEffect(() => {
    const saved = localStorage.getItem("rviz-lang");
    if (saved === "zh" || saved === "en") setLangState(saved);
  }, []);
  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    localStorage.setItem("rviz-lang", l);
  }, []);
  return <LangCtx.Provider value={{ lang, setLang }}>{children}</LangCtx.Provider>;
}

export function useLang() {
  return useContext(LangCtx);
}

export function useT() {
  const { lang } = useContext(LangCtx);
  return useCallback(
    (key: TKey) => dict[key][lang === "zh" ? 1 : 0],
    [lang],
  );
}
