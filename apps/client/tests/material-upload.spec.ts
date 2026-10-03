import { expect, test } from "@playwright/test";
import { completedOnboarding } from "./completed-onboarding";

test("course materials accept documents and images through upload and chat attachment inputs", async ({
  page,
}) => {
  await completedOnboarding(page);
  await page.route("**/api/me", (route) =>
    route.fulfill({
      json: {
        id: "student",
        nickname: "小芽",
        email: "student@example.com",
        avatar: "",
      },
    }),
  );
  const course = {
    id: "files-course",
    title: "文件学习",
    topic: "学习变量",
    status: "active",
    cover: { motif: "code", palette: "sprout", label: "学习" },
    state: {
      messages: [],
      pages: [],
      presentations: [],
      currentPresentationId: "",
    },
    sections: [],
    createdAt: "2026-10-03T00:00:00Z",
    updatedAt: "2026-10-03T00:00:00Z",
  };
  await page.route("**/api/courses", (route) =>
    route.fulfill({ json: { courses: [course] } }),
  );
  await page.route("**/api/courses/*/outline-reorganization", (route) =>
    route.fulfill({ status: 404, json: { error: "没有待处理任务" } }),
  );
  await page.route("**/api/courses/files-course/materials", (route) =>
    route.fulfill({ json: { materials: [] } }),
  );
  let name = "";
  await page.route("**/api/courses/files-course/material-uploads", (route) => {
    name = route.request().postDataJSON().name;
    return route.fulfill({
      json: {
        upload: {
          id: "upload",
          url: "https://storage.test/fixture",
          headers: {},
          expiresAt: "2026-10-03T01:00:00Z",
        },
      },
    });
  });
  await page.route("https://storage.test/fixture", (route) =>
    route.fulfill({ status: 200, body: "" }),
  );
  await page.route(
    "**/api/courses/files-course/material-uploads/upload/complete",
    (route) =>
      route.fulfill({
        json: {
          material: {
            id: name,
            name,
            mediaType: "application/octet-stream",
            sizeBytes: 12,
            parseStatus: "pending",
            parseRevision: 1,
            createdAt: "2026-10-03T00:00:00Z",
          },
        },
      }),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "打开课程：文件学习" }).click();
  await page.getByRole("button", { name: "课程材料", exact: true }).click();
  const composer = page.locator(".course-home-composer");
  for (const extension of [
    "md",
    "txt",
    "doc",
    "docx",
    "ppt",
    "pptx",
    "PDF",
    "png",
    "jpg",
    "jpeg",
    "webp",
    "bmp",
    "tif",
    "tiff",
  ]) {
    const filename = `学习资料.${extension}`;
    // Some desktop browsers provide no useful MIME type; the filename still identifies the format.
    const file = {
      name: filename,
      mimeType: "application/octet-stream",
      buffer: Buffer.from("test fixture"),
    };
    await page.getByLabel("选择课程材料").setInputFiles(file);
    await expect(
      page.getByRole("button", { name: filename, exact: true }),
    ).toBeVisible();
    await page.getByLabel("Upload files").setInputFiles(file);
    await expect(
      composer.getByRole("button", { name: `移除材料：${filename}` }),
    ).toBeVisible();
    await composer
      .getByRole("button", { name: `移除材料：${filename}` })
      .click();
  }
  await page.getByLabel("选择课程材料").setInputFiles({
    name: "bad.exe",
    mimeType: "text/plain",
    buffer: Buffer.from("unsupported"),
  });
  await expect(page.getByRole("alert")).toContainText("支持");
  await expect(
    page.getByRole("button", { name: "bad.exe", exact: true }),
  ).toHaveCount(0);
  await page.getByLabel("Upload files").setInputFiles({
    name: "bad.exe",
    mimeType: "text/plain",
    buffer: Buffer.from("unsupported"),
  });
  await expect(
    composer.getByRole("button", { name: "移除材料：bad.exe" }),
  ).toHaveCount(0);
  const dropped = await page.evaluateHandle(() => {
    const transfer = new DataTransfer();
    transfer.items.add(
      new File(["test fixture"], "拖放资料.pdf", { type: "application/pdf" }),
    );
    return transfer;
  });
  await page
    .getByRole("button", { name: "上传课程材料", exact: true })
    .dispatchEvent("drop", { dataTransfer: dropped });
  await expect(
    page.getByRole("button", { name: "拖放资料.pdf", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "拖放资料.pdf", exact: true }),
  ).toBeDisabled();
  await page.getByLabel("选择课程材料").setInputFiles({
    name: "too-large.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.alloc(3 * 1024 * 1024 + 1),
  });
  await expect(
    page.locator(".course-home-materials").getByRole("alert"),
  ).toHaveText("单个课程材料不能超过 3 MB");
  await expect(
    page.getByRole("button", { name: "too-large.pdf", exact: true }),
  ).toHaveCount(0);
});

for (const surface of ["new", "conversation", "overview"] as const) {
  for (const outcome of ["ready", "failed"] as const) {
    test(`material parsing reports batch progress before calling the model (${surface}, ${outcome})`, async ({
      page,
    }, testInfo) => {
      await completedOnboarding(page);
      await page.route("**/api/me", (route) =>
        route.fulfill({
          json: {
            id: "student",
            nickname: "小芽",
            email: "student@example.com",
            avatar: "",
          },
        }),
      );
      await page.route("**/api/learning/model", (route) =>
        route.fulfill({ json: { available: true, id: "test-model" } }),
      );
      const course = {
        id: "binary-course",
        conversationId: "binary-chat",
        title: "变量笔记",
        topic: "学习变量",
        status: "active",
        cover: { motif: "code", palette: "sprout", label: "学习" },
        state: {
          messages:
            surface === "conversation"
              ? [{ id: 1, role: "assistant", text: "已有学习内容" }]
              : [],
          pages: [],
          presentations: [],
          currentPresentationId: "",
        },
        sections: [],
        createdAt: "2026-10-03T00:00:00Z",
        updatedAt: "2026-10-03T00:00:00Z",
      };
      if (surface === "conversation")
        Object.assign(course, {
          sections: [
            {
              id: "binary-section",
              title: "变量",
              objective: "学习变量",
              position: 0,
              status: "active",
              conversations: [
                {
                  id: "binary-chat",
                  sectionId: "binary-section",
                  title: "学习",
                  state: course.state,
                  createdAt: course.createdAt,
                  updatedAt: course.updatedAt,
                },
              ],
            },
          ],
        });
      await page.route("**/api/courses", (route) =>
        route.fulfill({
          json:
            route.request().method() === "POST"
              ? { course }
              : { courses: surface === "new" ? [] : [course] },
        }),
      );
      await page.route("**/api/courses/binary-course/conversation", (route) =>
        route.fulfill({ json: { ok: true } }),
      );
      await page.route(
        "**/api/courses/binary-course/outline-reorganization",
        (route) =>
          route.fulfill({ status: 404, json: { error: "没有待处理任务" } }),
      );
      const original = Buffer.from([
        0x50, 0x4b, 0x03, 0x04, 0x00, 0xff, 0x80, 0xfe, 0x41,
      ]);
      let uploaded: Buffer | null = null;
      let size = 0;
      let uploadIndex = 0;
      await page.route(
        "**/api/courses/binary-course/material-uploads",
        (route) => {
          size = route.request().postDataJSON().sizeBytes;
          uploadIndex++;
          return route.fulfill({
            json: {
              upload: {
                id: `binary-upload-${uploadIndex}`,
                url: "https://storage.test/binary",
                headers: {
                  "Content-Type":
                    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                },
              },
            },
          });
        },
      );
      await page.route("https://storage.test/binary", (route) => {
        uploaded = route.request().postDataBuffer();
        return route.fulfill({ status: 200, body: "" });
      });
      let releaseParsing!: () => void;
      const parsing = new Promise<void>((resolve) => {
        releaseParsing = resolve;
      });
      let releaseSecond!: () => void;
      const secondParsing = new Promise<void>((resolve) => {
        releaseSecond = resolve;
      });
      let parsingIndex = 0;
      await page.route(
        "**/api/courses/binary-course/material-uploads/binary-upload-*/complete",
        async (route) => {
          const index = ++parsingIndex;
          await (index === 1 ? parsing : secondParsing);
          if (outcome === "failed" && index === 2)
            return route.fulfill({
              status: 409,
              json: { error: "材料解析失败：无法读取文件" },
            });
          return route.fulfill({
            json: {
              material: {
                id: `binary-${index}`,
                name: index === 1 ? "笔记.docx" : "课堂.pptx",
                parseStatus: "ready",
                sizeBytes: original.length,
                mediaType:
                  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
              },
            },
          });
        },
      );
      let turns = 0;
      await page.route("**/api/learning/course/model", (route) => {
        turns++;
        const delta = { role: "assistant", content: "材料上传完成" };
        const event = (delta: object, finish_reason: string | null) =>
          `data: ${JSON.stringify({ id: "test", object: "chat.completion.chunk", created: 1, model: "test-model", choices: [{ index: 0, delta, finish_reason }] })}\n\n`;
        return route.fulfill({
          contentType: "text/event-stream",
          body: event(delta, null) + event({}, "stop") + "data: [DONE]\n\n",
        });
      });
      await page.goto("/");
      if (surface !== "new")
        await page.getByRole("button", { name: "打开课程：变量笔记" }).click();
      if (surface === "conversation")
        await page.getByRole("button", { name: "打开小节：变量" }).click();
      await expect(
        page.getByRole("textbox", {
          name:
            surface === "overview"
              ? "告诉知芽你想开始什么新的学习"
              : "告诉知芽你想学什么",
        }),
      ).toBeVisible();
      await page.getByLabel("Upload files").setInputFiles([
        {
          name: "笔记.docx",
          mimeType:
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          buffer: original,
        },
        {
          name: "课堂.pptx",
          mimeType: "application/octet-stream",
          buffer: original,
        },
      ]);
      await expect(
        page.getByRole("button", { name: "移除材料：笔记.docx" }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "移除材料：课堂.pptx" }),
      ).toBeVisible();
      await page
        .getByRole("textbox", {
          name:
            surface === "overview"
              ? "告诉知芽你想开始什么新的学习"
              : "告诉知芽你想学什么",
        })
        .fill("这是我的笔记，继续教我");
      await page
        .getByRole("button", {
          name: surface === "overview" ? "开始新的学习" : "发送",
          exact: true,
        })
        .click();
      await expect.poll(() => parsingIndex).toBe(1);
      const progress = page.getByRole("progressbar", { name: "材料解析进度" });
      await expect(progress).toHaveAttribute("aria-valuenow", "0");
      await expect(progress).toHaveAttribute("aria-valuemax", "2");
      await expect(page.getByRole("status", { name: "生成状态" })).toHaveCount(
        0,
      );
      await expect(
        page.getByRole("status").filter({ has: progress }),
      ).toContainText("正在解析第 1 / 2 份：笔记.docx");
      if (surface === "new") {
        const waiting = page.getByRole("status").filter({ has: progress });
        const thread = page.locator(".course-thread");
        const waitingBounds = await waiting.boundingBox();
        const threadBounds = await thread.boundingBox();
        expect(waitingBounds!.y - threadBounds!.y).toBeLessThan(80);
        await expect(
          page.getByRole("heading", { name: "开始新的学习对话" }),
        ).toHaveCount(0);
      }
      expect(turns).toBe(0);
      releaseParsing();
      await expect.poll(() => parsingIndex).toBe(2);
      await expect(progress).toHaveAttribute("aria-valuenow", "1");
      await expect(
        page.getByRole("status").filter({ has: progress }),
      ).toContainText("正在解析第 2 / 2 份：课堂.pptx");
      expect(turns).toBe(0);
      if (surface === "new" && outcome === "ready") {
        await page.screenshot({
          path: testInfo.outputPath("parsing-desktop.png"),
          animations: "disabled",
        });
        await page.setViewportSize({ width: 390, height: 844 });
        await expect(progress).toBeInViewport();
        const mobileWaiting = await page
          .getByRole("status")
          .filter({ has: progress })
          .boundingBox();
        const mobileThread = await page.locator(".course-thread").boundingBox();
        expect(mobileWaiting!.y - mobileThread!.y).toBeLessThan(80);
        await page.screenshot({
          path: testInfo.outputPath("parsing-mobile.png"),
          animations: "disabled",
        });
      }
      releaseSecond();
      if (outcome === "failed") {
        await expect(page.getByRole("alert")).toContainText("解析失败");
        await expect(
          page.getByRole("status").filter({ has: progress }),
        ).toContainText("解析失败：课堂.pptx");
        await expect(progress).toHaveAttribute("aria-valuenow", "1");
        expect(turns).toBe(0);
      } else {
        await expect(
          page.getByText("材料上传完成", { exact: true }),
        ).toBeVisible();
      }
      expect(uploaded).toEqual(original);
      expect(size).toBe(original.length);
    });
  }
}
