import { expect, test, type WebSocketRoute } from "@playwright/test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { completedOnboarding } from "./completed-onboarding";

test("classroom and document support edits, export files and retain independent share settings", async ({ page, context }, testInfo) => {
  await completedOnboarding(page);
  await page.route("**/api/me", (route) => route.fulfill({ json: { id: "student", nickname: "小芽", email: "student@example.com", avatar: "" } }));
  await page.route("**/api/learning/model", (route) => route.fulfill({ json: { id: "test", available: true } }));
  const question = { id: "question", kind: "question", title: "课堂练习", text: "人工智能可以识别图片吗？", questionKind: "true_false", options: ["正确", "错误"], selected: [], answerText: "", status: "active" };
  const lesson = { messages: [{ id: 1, role: "assistant", text: "课件和文档已准备完成。", pageId: "question" }], pages: [question], presentations: [{ id: "shown", pageId: "question" }], currentPresentationId: "shown" };
  const conversation = { id: "lesson", sectionId: "section", title: "人工智能入门", state: lesson, createdAt: "2026-10-03", updatedAt: "2026-10-03" };
  const course = {
    id: "course", title: "人工智能", topic: "人工智能", status: "active", cover: { motif: "orbit", palette: "sprout", label: "AI" }, conversationId: "lesson", state: lesson,
    sections: [{ id: "section", title: "第一课", objective: "认识 AI", position: 0, status: "active", conversations: [conversation] }], createdAt: "2026-10-03", updatedAt: "2026-10-03",
  };
  const materialBlocks = [
    { id: "intro", title: "认识人工智能", markdown: "语音助手帮助我们查询天气。\n\n从生活中的例子认识人工智能。", imageIds: ["picture"] },
    { id: "examples", title: "生活中的例子", markdown: "寻找身边的人工智能。", imageIds: [] },
  ];
  const picture = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAACAAAAAYCAIAAAAUMWhjAAAAJklEQVR4nGP0ro1ioCVgoqnpoxaMWjBqwagFoxaMWjBqwagFVAMALtoBUr9C5zIAAAAASUVORK5CYII=", "base64");
  await page.route("**/api/courses/course/deliverable-images/picture", (route) => route.fulfill({ json: { url: new URL("/test-picture.png", route.request().url()).href, headers: {} } }));
  await page.route("**/test-picture.png", (route) => route.fulfill({ contentType: "image/png", body: picture }));
  const materials = [{ id: "handout", kind: "document", title: "补充阅读", source: "", revision: 1, blocks: materialBlocks, updatedAt: "2026-10-03" }];
  let contentVersion = 1;
  const files = () => {
    const block = { id: "question-source", title: question.title, markdown: question.text + "\n\n1. 正确\n\n2. 错误", imageIds: [], source: { conversationId: "lesson", pageId: "question" } };
    return [
      { id: "classroom", kind: "presentation", source: "classroom", title: course.title, revision: contentVersion, blocks: [block, ...materials.filter((m) => m.kind === "presentation").flatMap((m) => m.blocks)], updatedAt: "2026-10-03" },
      { id: "course-document", kind: "document", source: "course-document", title: course.title + " · 课程文档", revision: contentVersion, blocks: [block, ...materials.flatMap((m) => m.blocks)], updatedAt: "2026-10-03" },
      ...materials,
    ];
  };
  await page.route("**/api/courses", (route) => route.fulfill({ json: { courses: [course] } }));
  await page.route("**/api/courses/course/deliverables", (route) => route.fulfill({ json: { deliverables: files() } }));
  await page.route("**/api/courses/course/deliverables/*", (route) => {
    if (route.request().url().endsWith("/import")) {
      expect(route.request().postDataJSON().name).toBe("已有课件.pptx");
      const imported = { ...materials[0], id: "imported", kind: "presentation", title: "已有课件" };
      materials.push(imported);
      contentVersion++;
      return route.fulfill({ status: 201, json: { deliverable: imported } });
    }
    return route.fulfill({ json: { deliverable: files().find((i) => route.request().url().endsWith(i.id)) } });
  });
  const shares = new Map<string, { token: string; visibility: string }>();
  await page.route("**/api/courses/course/deliverables/*/share", (route) => {
    const id = route.request().url().split("/").at(-2)!;
    const saved = shares.get(id) ?? { token: "", visibility: "private" };
    if (route.request().method() === "PUT") {
      saved.visibility = route.request().postDataJSON().visibility;
      saved.token ||= `share-${id}`;
      shares.set(id, saved);
    }
    return route.fulfill({ json: saved });
  });
  let revision = 1;
  const state: any = { course, conversationId: "lesson", lesson, busy: false, generating: false, commands: {} };
  const sockets = new Set<WebSocketRoute>();
  const snapshot = () => ({ id: "session", revision, state });
  await page.route("**/api/agent/sessions", (route) => route.fulfill({ status: 201, json: snapshot() }));
  await page.route("**/api/agent/sessions/*/commands", (route) => {
    const input = route.request().postDataJSON();
    if (input.action === "selectDeliverable") state.deliverableSelection = input.args[0] ? { id: input.args[0], blockId: input.args[1] } : null;
    if (input.action === "prompt") {
      expect(state.deliverableSelection).toEqual({ id: "course-document", blockId: "question-source" });
      question.text = "校园里的人工智能可以识别图片吗？";
      contentVersion++;
      // Refresh follows classroom source, without a separate saved PPT edit.
    }
    state.commands[input.requestId] = { status: "complete" };
    revision++;
    for (const socket of sockets) socket.send(JSON.stringify(snapshot()));
    return route.fulfill({ status: 202, json: { ok: true } });
  });
  await page.routeWebSocket("**/api/agent/socket*", (socket) => socket.send(JSON.stringify({ sessions: [] })));
  await page.routeWebSocket("**/api/agent/sessions/*/socket*", (socket) => {
    sockets.add(socket);
    socket.onClose(() => sockets.delete(socket));
    socket.send(JSON.stringify(snapshot()));
  });
  await page.goto("/#/courses/course/conversations/lesson");
  await expect(page.getByRole("region", { name: "课堂页面" })).toContainText(question.text);
  await expect(page.getByRole("button", { name: "导出与分享" })).toBeEnabled();
  await expect(page.getByRole("navigation", { name: "工作区区域" }).getByRole("button")).toHaveCount(2);
  await expect(page.getByRole("button", { name: "展开交付产物侧栏" })).toHaveAttribute("aria-expanded", "false");
  await page.getByRole("button", { name: "文档", exact: true }).click();
  const documentPreview = page.getByRole("region", { name: "文档预览" });
  await expect(documentPreview).toContainText("人工智能可以识别图片吗");
  await expect(documentPreview).toContainText("从生活中的例子认识人工智能");
  await expect(documentPreview).not.toContainText("课件和文档已准备完成");
  await expect.poll(() => state.deliverableSelection).toEqual({ id: "course-document", blockId: "question-source" });
  await expect(page.getByRole("button", { name: "展开交付产物侧栏" })).toHaveAttribute("aria-expanded", "false");
  await page.getByRole("textbox", { name: "告诉知芽你想学什么" }).fill("把问题改成校园里的人工智能");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(documentPreview).toContainText("校园里的人工智能可以识别图片吗");
  await page.screenshot({ path: testInfo.outputPath("course-document-collapsed.png") });
  await page.getByRole("button", { name: "导出与分享" }).click();
  await page.getByRole("menuitem", { name: "分享设置" }).click();
  const sharing = page.getByRole("dialog", { name: "分享设置" });
  await expect(sharing.getByRole("radio", { name: /仅自己可见/ })).toBeChecked();
  await expect(sharing.getByLabel("固定分享链接")).toHaveCount(0);
  await sharing.getByRole("radio", { name: /获得链接的任何人可见/ }).click();
  await expect(sharing.getByRole("radio", { name: /获得链接的任何人可见/ })).toBeChecked();
  await expect(sharing.getByLabel("固定分享链接")).toHaveValue(/#\/shares\/share-course-document$/);
  const fixedLink = await sharing.getByLabel("固定分享链接").inputValue();
  await page.screenshot({ path: testInfo.outputPath("document-sharing.png") });
  await sharing.getByRole("radio", { name: /仅自己可见/ }).click();
  await expect(sharing.getByRole("status")).toContainText("已关闭外部访问");
  await expect(sharing.getByLabel("固定分享链接")).toHaveValue(fixedLink);
  await sharing.getByRole("button", { name: "完成", exact: true }).click();
  await page.getByRole("button", { name: "导出与分享" }).click();
  await page.getByRole("menuitem", { name: "分享设置" }).click();
  await expect(sharing.getByRole("radio", { name: /仅自己可见/ })).toBeChecked();
  await expect(sharing.getByLabel("固定分享链接")).toHaveValue(fixedLink);
  await sharing.getByRole("radio", { name: /获得链接的任何人可见/ }).click();
  await expect(sharing.getByRole("status")).toContainText("已开放分享");
  await expect(sharing.getByLabel("固定分享链接")).toHaveValue(fixedLink);
  await sharing.getByRole("button", { name: "完成", exact: true }).click();
  const wordEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出与分享" }).click();
  await page.getByRole("menuitem", { name: "下载 Word" }).click();
  const word = await wordEvent;
  expect(word.suggestedFilename()).toBe("人工智能 · 课程文档.docx");
  const wordPath = testInfo.outputPath("course.docx");
  await word.saveAs(wordPath);
  const unzip = promisify(execFile);
  const wordXml = (await unzip("unzip", ["-p", wordPath, "word/document.xml"])).stdout;
  expect(wordXml).toContain("校园里的人工智能");
  expect(wordXml).toContain("从生活中的例子认识人工智能");
  await page.getByRole("button", { name: "展开交付产物侧栏" }).click();
  const sidebar = page.getByRole("complementary", { name: "交付产物侧栏" });
  const expandedPreview = (await documentPreview.boundingBox())!;
  const expandedSidebar = (await sidebar.boundingBox())!;
  expect(expandedSidebar.x).toBeGreaterThanOrEqual(expandedPreview.x + expandedPreview.width - 1);
  expect(expandedSidebar.x + expandedSidebar.width).toBeCloseTo(page.viewportSize()!.width, 0);
  await page.getByRole("button", { name: "收起交付产物侧栏" }).click();
  expect((await documentPreview.boundingBox())!.width).toBeGreaterThan(expandedPreview.width + 80);
  await page.getByRole("button", { name: "课堂展示", exact: true }).click();
  await expect(page.getByRole("region", { name: "课堂页面" })).toContainText(question.text);
  await page.getByRole("button", { name: "导出与分享" }).click();
  await page.getByRole("menuitem", { name: "分享设置" }).click();
  await expect(sharing.getByRole("radio", { name: /仅自己可见/ })).toBeChecked();
  await expect(sharing.getByLabel("固定分享链接")).toHaveCount(0);
  await sharing.getByRole("button", { name: "完成", exact: true }).click();
  const pptEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出与分享" }).click();
  await page.getByRole("menuitem", { name: "下载 PPTX" }).click();
  const ppt = await pptEvent;
  expect(ppt.suggestedFilename()).toBe("人工智能.pptx");
  const pptPath = testInfo.outputPath("course.pptx");
  await ppt.saveAs(pptPath);
  expect((await unzip("unzip", ["-p", pptPath, "ppt/slides/slide1.xml"])).stdout).toContain("校园里的人工智能");
  await page.reload();
  await expect(page.getByRole("button", { name: "展开交付产物侧栏" })).toHaveAttribute("aria-expanded", "false");
  await page.getByRole("button", { name: "展开交付产物侧栏" }).click();
  await page.getByLabel("导入 PPT 文件").setInputFiles({ name: "已有课件.pptx", mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation", buffer: Buffer.from("test upload") });
  await expect(page.getByRole("heading", { name: "已有课件", exact: true })).toBeVisible();
  await expect(page.frameLocator('iframe[title="课件页面：认识人工智能"]').locator("body")).toContainText("语音助手");
  const importedEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出与分享" }).click();
  await page.getByRole("menuitem", { name: "下载 PPTX" }).click();
  const importedDownload = await importedEvent;
  expect(importedDownload.suggestedFilename()).toBe("已有课件.pptx");
  const importedPath = testInfo.outputPath("imported.pptx");
  await importedDownload.saveAs(importedPath);
  const importedXml = (await unzip("unzip", ["-p", importedPath, "ppt/slides/*.xml"])).stdout;
  expect(importedXml).toContain("语音助手帮助我们查询天气");
  expect(importedXml).not.toContain("校园里的人工智能");
  const htmlEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出与分享" }).click();
  await page.getByRole("menuitem", { name: "下载 HTML 单文件" }).click();
  const htmlDownload = await htmlEvent;
  expect(htmlDownload.suggestedFilename()).toBe("已有课件.html");
  const htmlPath = testInfo.outputPath("presentation.html");
  await htmlDownload.saveAs(htmlPath);
  const offline = await context.newPage();
  await offline.goto(pathToFileURL(htmlPath).href);
  await context.setOffline(true);
  await offline.reload();
  await expect(offline.getByRole("img", { name: "认识人工智能", exact: true })).toBeVisible();
  expect(await offline.getByRole("img", { name: "认识人工智能", exact: true }).evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth === 32)).toBe(true);
  await expect(offline.getByText("语音助手帮助我们查询天气。")).toBeVisible();
  await expect(offline.getByText("寻找身边的人工智能。")).toBeHidden();
  await offline.getByRole("button", { name: "下一页", exact: true }).click();
  await expect(offline.getByText("寻找身边的人工智能。")).toBeVisible();
  await offline.getByRole("button", { name: "阅读全部", exact: true }).click();
  await expect(offline.getByText("语音助手帮助我们查询天气。")).toBeVisible();
  await offline.screenshot({ path: testInfo.outputPath("offline-html.png") });
  await offline.close();
  await context.setOffline(false);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "导出与分享" }).scrollIntoViewIfNeeded();
  await expect(page.getByRole("button", { name: "导出与分享" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole("button", { name: "收起交付产物侧栏" }).click();
  const mobileSidebar = (await sidebar.boundingBox())!;
  expect(mobileSidebar.x + mobileSidebar.width).toBeCloseTo(390, 0);
  await page.screenshot({ path: testInfo.outputPath("classroom-mobile.png") });
});
