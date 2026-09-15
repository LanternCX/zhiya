import type { ChatComposerAttachmentOptions } from "../../components/ChatComposer";

export const courseMaterialAttachments: ChatComposerAttachmentOptions = {
  accept: "text/markdown,text/plain",
  addLabel: "添加教学材料",
  dropHint: "支持 Markdown、TXT，单个文件不超过 3 MB",
  dropLabel: "松开以添加教学材料",
  errorMessage: (code) =>
    code === "max_file_size"
      ? "单个课程材料不能超过 3 MB"
      : code === "accept"
        ? "目前仅支持 Markdown 和 TXT 文件"
        : "附带的课程材料过多",
  maxFileSize: 3 * 1024 * 1024,
  multiple: true,
  removeLabel: (filename) => `移除材料：${filename}`,
};
