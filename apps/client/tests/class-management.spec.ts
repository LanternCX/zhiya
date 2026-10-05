import { expect, test, type Page } from "@playwright/test";
import { completedOnboarding } from "./completed-onboarding";

async function setup(page: Page, role: "head" | "teacher" | "student" = "head") {
  await completedOnboarding(page);
  await page.route("**/api/me", route => route.fulfill({ json: { id: role, role: role === "student" ? "student" : "teacher", nickname: "测试用户", avatar: "", email: "private@example.com" } }));
  await page.route("**/api/courses", route => route.fulfill({ json: { courses: [] } }));
  const state = {
    classroom: { id: "one", name: "人工智能探索班", headTeacherId: "head", headTeacherName: "林老师", memberCount: 3, members: [
      { id: "head", nickname: "林老师", avatar: "", role: "head_teacher" },
      { id: "teacher", nickname: "陈老师", avatar: "", role: "teacher" },
      { id: "student", nickname: "小芽", avatar: "", role: "student" },
    ] },
    removed: [] as { id: string; nickname: string; avatar: string; role: string }[],
    exists: true,
    failRename: false,
  };
  await page.route("**/api/classes**", async route => {
    const path = new URL(route.request().url()).pathname;
    const method = route.request().method();
    if (path.endsWith("/removed-members")) return route.fulfill({ json: { members: state.removed } });
    if (path.includes("/removed-members/")) {
      state.removed = state.removed.filter(member => member.id !== path.split("/").at(-1));
    } else if (path.includes("/members/")) {
      const member = state.classroom.members.find(member => member.id === path.split("/").at(-1))!;
      state.removed.push(member);
      state.classroom.members = state.classroom.members.filter(value => value.id !== member.id);
      state.classroom.memberCount--;
    } else if (path.endsWith("/transfer")) {
      expect(route.request().postDataJSON().memberId).toBe("teacher");
      state.classroom.headTeacherId = "teacher";
      state.classroom.headTeacherName = "陈老师";
      state.classroom.members.forEach(member => { if (member.id === "head") member.role = "teacher"; if (member.id === "teacher") member.role = "head_teacher"; });
    } else if (path.endsWith("/leave")) {
      state.classroom.members = state.classroom.members.filter(member => member.id !== role);
    } else if (method === "PATCH") {
      if (state.failRename) return route.fulfill({ status: 500, json: { error: "保存失败，请重试" } });
      state.classroom.name = route.request().postDataJSON().name;
    } else if (method === "DELETE") {
      expect(route.request().postDataJSON().name).toBe(state.classroom.name);
      state.exists = false;
    } else if (path.endsWith("/classes")) {
      return route.fulfill({ json: { classes: state.exists && state.classroom.members.some(member => member.id === role) ? [state.classroom] : [] } });
    } else {
      return route.fulfill({ json: { class: state.classroom } });
    }
    return route.fulfill({ json: { ok: true } });
  });
  return state;
}

test("head manages settings and members on a separate page, retaining drafts after failure", async ({ page }) => {
  const state = await setup(page);
  await page.goto("/#/classes/one");
  await expect(page.getByRole("button", { name: "解散班级", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "管理小芽", exact: true })).toHaveCount(0);
  await page.getByRole("link", { name: "管理班级", exact: true }).click();
  await expect(page).toHaveURL(/\/classes\/one\/manage$/);
  await page.getByRole("textbox", { name: "班级名称", exact: true }).fill("新的探索班");
  state.failRename = true;
  await page.getByRole("button", { name: "保存名称" }).click();
  await expect(page.getByRole("alert")).toHaveText("保存失败，请重试");
  await expect(page.getByRole("textbox", { name: "班级名称", exact: true })).toHaveValue("新的探索班");
  state.failRename = false;
  await page.getByRole("button", { name: "保存名称" }).click();
  await expect(page.getByRole("status")).toHaveText("班级名称已保存");
  await page.reload();
  await expect(page.getByRole("textbox", { name: "班级名称", exact: true })).toHaveValue("新的探索班");
  await page.getByRole("tab", { name: "成员管理" }).click();
  await page.getByRole("button", { name: "管理小芽" }).click();
  await page.getByRole("menuitem", { name: "移出班级" }).click();
  const remove = page.getByRole("dialog", { name: "移出小芽？" });
  await remove.getByRole("button", { name: "取消" }).click();
  await expect(page.getByRole("article", { name: "小芽" })).toBeVisible();
  await page.getByRole("button", { name: "管理小芽" }).click();
  await page.getByRole("menuitem", { name: "移出班级" }).click();
  await remove.getByRole("button", { name: "确认移出" }).click();
  await expect(page.getByRole("article", { name: "小芽" })).toHaveCount(0);
  await page.getByRole("tab", { name: "已移出成员" }).click();
  await expect(page.getByRole("article", { name: "小芽" })).toBeVisible();
  await page.getByRole("button", { name: "解除小芽的加入限制" }).click();
  await page.getByRole("dialog", { name: "解除加入限制？" }).getByRole("button", { name: "解除限制", exact: true }).click();
  await expect(page.getByText("没有被移出的成员")).toBeVisible();
  await page.getByRole("tab", { name: "成员管理" }).click();
  await expect(page.getByRole("article", { name: "小芽" })).toHaveCount(0);
  await page.getByRole("tab", { name: "基本设置" }).click();
  await page.getByRole("button", { name: "转交班主任", exact: true }).click();
  await page.getByLabel("新班主任").selectOption("teacher");
  await page.getByRole("button", { name: "确认转交" }).click();
  await expect(page).toHaveURL(/\/classes\/one$/);
  await expect(page.getByRole("link", { name: "管理班级" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "退出班级" })).toBeVisible();
});

test("dissolving requires the exact class name and returns to the class list", async ({ page }) => {
  await setup(page);
  await page.goto("/#/classes/one/manage");
  await page.getByRole("button", { name: "解散班级", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "解散班级？" });
  await dialog.getByLabel("输入班级名称确认").fill("错误名称");
  await expect(dialog.getByRole("button", { name: "确认解散" })).toBeDisabled();
  await dialog.getByLabel("输入班级名称确认").fill("人工智能探索班");
  await dialog.getByRole("button", { name: "确认解散" }).click();
  await expect(page).toHaveURL(/\/classes$/);
  await expect(page.getByRole("link", { name: /人工智能探索班/ })).toHaveCount(0);
});

for (const role of ["teacher", "student"] as const) {
  test(`${role} cannot manage classes and only subject teachers can leave`, async ({ page }) => {
    await setup(page, role);
    await page.goto("/#/classes/one/manage");
    await expect(page.getByRole("alert")).toHaveText("只有本班班主任可以管理班级");
    await expect(page.getByRole("tab", { name: "基本设置" })).toHaveCount(0);
    await page.getByRole("link", { name: "返回班级面板" }).click();
    await expect(page.getByRole("link", { name: "管理班级" })).toHaveCount(0);
    if (role === "teacher") {
      await page.getByRole("button", { name: "退出班级" }).click();
      await page.getByRole("button", { name: "确认退出" }).click();
      await expect(page).toHaveURL(/\/classes$/);
      await expect(page.getByRole("link", { name: /人工智能探索班/ })).toHaveCount(0);
    } else await expect(page.getByRole("button", { name: "退出班级" })).toHaveCount(0);
  });
}

test("management fits narrow screens and long names in both themes", async ({ page }) => {
  const state = await setup(page);
  state.classroom.name = "人工智能与编程探索班".repeat(8);
  state.classroom.members[1].nickname = "名字很长的任课老师".repeat(8);
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto("/#/classes/one/manage");
  for (const theme of ["light", "dark"]) {
    await page.evaluate(theme => localStorage.setItem("zhiya-theme", theme), theme);
    await page.reload();
    await expect(page.getByRole("heading", { name: "班级管理", exact: true })).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    for (const tab of ["基本设置", "成员管理", "已移出成员"]) {
      await page.getByRole("tab", { name: tab }).click();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    }
  }
});
