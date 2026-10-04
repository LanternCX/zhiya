import { invoke, isTauri } from "@tauri-apps/api/core";

export async function saveDeliverable(blob: Blob, name: string): Promise<void> {
  if (isTauri()) {
    try {
      await invoke("save_deliverable", {
        name,
        bytes: Array.from(new Uint8Array(await blob.arrayBuffer())),
      });
    } catch (error) {
      throw new Error(typeof error === "string" ? error : "文件保存失败");
    }
    return;
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30000);
}
