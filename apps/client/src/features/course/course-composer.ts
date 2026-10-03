import type { ChatComposerAttachmentOptions } from "../../components/ChatComposer";

export const courseMaterialTypes = {
  "text/markdown": [".md"],
  "text/plain": [".txt"],
  "application/pdf": [".pdf"],
  "application/msword": [".doc"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"],
  "application/vnd.ms-powerpoint": [".ppt"],
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": [".pptx"],
  "image/png": [".png"],
  "image/jpeg": [".jpg", ".jpeg"],
  "image/webp": [".webp"],
  "image/bmp": [".bmp"],
  "image/tiff": [".tif", ".tiff"],
};
const extensions = Object.values(courseMaterialTypes).flat();
export const courseMaterialFormatHint = "支持 Markdown、TXT、PDF、Word、PPT 和图片";
export const courseMaterialMaxSize = 3 * 1024 * 1024;

export function acceptsCourseMaterial(name: string) {
  return extensions.some(extension => name.toLowerCase().endsWith(extension));
}

export const courseMaterialAttachments: ChatComposerAttachmentOptions = {
  accept: extensions.join(","),
  addLabel: "添加教学材料",
  dropHint: `${courseMaterialFormatHint}，单个文件不超过 3 MB`,
  dropLabel: "松开以添加教学材料",
  errorMessage: (code) =>
    code === "max_file_size"
      ? "单个课程材料不能超过 3 MB"
      : code === "accept"
        ? courseMaterialFormatHint
        : "附带的课程材料过多",
  maxFileSize: courseMaterialMaxSize,
  multiple: true,
  removeLabel: (filename) => `移除材料：${filename}`,
};
