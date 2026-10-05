import { expect, test } from "@playwright/test";

test("registration requires one identity and retains the teacher choice through resend", async ({ page }) => {
  await page.route("**/api/me", route => route.fulfill({status:401,json:{error:"请登录"}}));
  let sent = 0;
  await page.route("**/api/auth/register/start", route => {
    sent++;
    return route.fulfill({json:{flow:`registration-${sent}`}});
  });
  let registered: Record<string,unknown> | undefined;
  await page.route("**/api/auth/register/complete", route => {
    registered=route.request().postDataJSON();
    return route.fulfill({json:{ok:true}});
  });
  await page.goto("/#/register");
  const email=page.getByLabel("邮箱",{exact:true});
  await email.fill("teacher@example.com");
  await page.getByRole("button",{name:"发送验证码",exact:true}).click();
  expect(sent).toBe(0);
  await page.getByRole("radio",{name:/我是老师/}).check();
  await expect(email).toHaveValue("teacher@example.com");
  await expect(page.getByRole("radio",{name:/我是学生/})).not.toBeChecked();
  await page.getByRole("button",{name:"发送验证码",exact:true}).click();
  await expect(page.getByText("老师账号",{exact:true})).toBeVisible();
  await page.getByLabel("密码",{exact:true}).fill("Teacher-password-123");
  await page.getByLabel("确认密码",{exact:true}).fill("Teacher-password-123");
  await page.clock.install();
  await page.clock.fastForward(31_000);
  await page.getByRole("button",{name:"重新发送验证码",exact:true}).click();
  await expect(page.getByText("老师账号",{exact:true})).toBeVisible();
  await page.getByLabel("验证码",{exact:true}).fill("12345678");
  await page.getByRole("button",{name:"完成注册",exact:true}).click();
  await expect(page.getByRole("heading",{name:"登录知芽"})).toBeVisible();
  expect(registered).toEqual({flow:"registration-2",code:"12345678",password:"Teacher-password-123",role:"teacher"});
});
