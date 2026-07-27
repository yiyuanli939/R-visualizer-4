"use client";

import { useEffect, useState } from "react";
import { useLang } from "@/lib/i18n";

/** In-app tutorial for the Local R engine (full desktop R, any package). */
export default function LocalGuide({ onClose }: { onClose: () => void }) {
  const { lang } = useLang();
  const zh = lang === "zh";
  const [origin, setOrigin] = useState("https://your-app.vercel.app");
  useEffect(() => setOrigin(window.location.origin), []);
  const cmd = `Rscript -e 'source("${origin}/rviz-local.R")'`;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const S = ({ n, title, children }: { n: number; title: string; children: React.ReactNode }) => (
    <div className="flex gap-3">
      <span
        className="flex-none w-6 h-6 rounded-full grid place-items-center text-[12px] font-bold"
        style={{ background: "var(--accent)", color: "#fff" }}
      >
        {n}
      </span>
      <div className="min-w-0">
        <div className="font-semibold mb-0.5" style={{ color: "var(--ink)" }}>{title}</div>
        <div className="text-[13px] leading-relaxed" style={{ color: "var(--ink-dim)" }}>{children}</div>
      </div>
    </div>
  );

  const Code = ({ children }: { children: string }) => (
    <pre
      className="mono text-[11.5px] rounded-lg px-3 py-2 my-1.5 overflow-x-auto cursor-pointer"
      style={{ background: "var(--code-bg)", border: "1px solid var(--line)", color: "var(--ink)" }}
      title={zh ? "点击复制" : "click to copy"}
      onClick={() => navigator.clipboard.writeText(children)}
    >
      {children}
    </pre>
  );

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center p-6"
      style={{ background: "rgba(8,12,22,.6)" }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="panel w-full max-w-[640px] max-h-[85vh] overflow-y-auto">
        <div className="panel-head">
          {zh ? "Local R 模式教程 — 用你自己的桌面 R 执行" : "Local R tutorial — run on your own desktop R"}
          <button className="ml-auto cursor-pointer normal-case" style={{ color: "var(--ink-faint)" }} onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="p-4 flex flex-col gap-4 text-[13px]">
          <p style={{ color: "var(--ink-dim)" }}>
            {zh
              ? "WebR 覆盖了大部分 CRAN，但有些包只存在于桌面 R（GitHub 包如 qss、无 wasm 构建的 Synth/MatchIt 等）。Local R 模式把同一套可视化协议接到你本机的 R 上——界面、步进、内存图、点选解释完全相同，只是执行位置和包来源不同。代码和数据不会离开你的电脑（页面只与 127.0.0.1 通信）。"
              : "webR covers most of CRAN, but some packages only exist in desktop R (GitHub packages like qss, or Synth/MatchIt without wasm builds). Local R mode connects this same visual protocol to the R on your machine — identical UI, stepping, memory diagrams and click-to-inspect; only the execution backend changes. Code and data never leave your computer (the page only talks to 127.0.0.1)."}
          </p>
          <S n={1} title={zh ? "装一次桥接依赖（R 或 RStudio 控制台）" : "Install the bridge deps once (in R / RStudio)"}>
            <Code>{`install.packages(c("httpuv", "jsonlite", "digest"))`}</Code>
            {zh ? "顺便装你脚本需要的任何包，例如 GitHub 包：" : "Also install anything your scripts need, e.g. a GitHub package:"}
            <Code>{`devtools::install_github("kosukeimai/qss-package")`}</Code>
          </S>
          <S n={2} title={zh ? "在数据所在目录启动本地后端" : "Start the local backend from your data directory"}>
            {zh ? "终端里 cd 到放数据文件的目录，然后：" : "cd to the folder holding your data files, then:"}
            <Code>{cmd}</Code>
            {zh
              ? "它会打印一个会话令牌（token）。上传的文件会落到这个目录，read_csv(\"…\") 也从这里解析。"
              : "It prints a session token. Uploads land in this directory and read_csv(\"…\") resolves against it."}
          </S>
          <S n={3} title={zh ? "切换引擎并粘贴令牌" : "Switch the engine and paste the token"}>
            {zh
              ? "顶栏把「WebR·浏览器」切成「本地 R」，在状态条的输入框粘贴令牌并点连接。状态条会显示你的 R 版本与工作目录，之后照常使用一切功能。"
              : "In the top bar switch “WebR · browser” to “Local R”, paste the token into the status-bar input and Connect. The status bar then shows your R version and working directory; everything else works as usual."}
          </S>
          <div className="rounded-lg px-3 py-2 text-[12px]" style={{ background: "var(--blue-soft)", color: "var(--ink-dim)" }}>
            <b style={{ color: "var(--ink)" }}>{zh ? "疑难排查" : "Troubleshooting"}</b>
            <ul className="list-disc pl-4 mt-1 flex flex-col gap-0.5">
              <li>{zh ? "令牌是每次启动新生成的；重启后端后需重新粘贴。可信机器可用 --no-token 关闭。" : "The token is regenerated per launch; paste again after restarting. Use --no-token on trusted machines."}</li>
              <li>{zh ? "Safari 目前阻止 HTTPS→127.0.0.1 请求，请用 Chrome/Edge/Firefox。" : "Safari currently blocks HTTPS→127.0.0.1; use Chrome/Edge/Firefox."}</li>
              <li>{zh ? "端口被占用时：Rscript rviz-local.R 8791（并无需改前端——默认端口 8790 被占才需要）。" : "Port busy? The default is 8790; free it or restart the old backend."}</li>
              <li>{zh ? "后端只绑定 127.0.0.1，且默认要求令牌——陌生网页无法驱动它。" : "The backend binds to 127.0.0.1 only and requires the token — arbitrary websites cannot drive it."}</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
