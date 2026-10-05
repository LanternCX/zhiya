import { expect, test } from "@playwright/test";
import { completedOnboarding } from "./completed-onboarding";

for (const role of ["teacher", "student"] as const) {
  test(`${role} can use class cards and see members with appropriate invitation controls`, async ({ page }) => {
    await completedOnboarding(page);
    await page.route("**/api/me", route => route.fulfill({json:{id:"self",role,nickname:"小芽",avatar:"",email:"private@example.com"}}));
    await page.route("**/api/courses", route => route.fulfill({json:{courses:[]}}));
    let created = role === "student";
    let code = "ABCDEFGHIJKLMNOP";
    const classroom = {
      id:"class-one",name:"人工智能探索班",headTeacherId:role==="teacher"?"self":"head",
      headTeacherName:"林老师",memberCount:3,
      members:[
        {id:role==="teacher"?"self":"head",nickname:"林老师",avatar:"",role:"head_teacher"},
        {id:"subject",nickname:"陈老师",avatar:"",role:"teacher"},
        {id:role==="student"?"self":"student",nickname:"小芽",avatar:"",role:"student"}
      ]
    };
    await page.route("**/api/classes**", route => {
      const url = new URL(route.request().url());
      if (url.pathname.endsWith("/invitation")) {
        if (route.request().method()==="POST") code="QRSTUVWXYZABCDEF";
        return route.fulfill({json:{code}});
      }
      if (route.request().method()==="POST") {
        const input=route.request().postDataJSON();
        if (url.pathname.endsWith("/join")) expect(input.code).toBe(code);
        else expect(input.name).toBe("人工智能探索班");
        created=true;
        return route.fulfill({status:url.pathname.endsWith("/join")?200:201,json:{class:classroom}});
      }
      return route.fulfill({json:url.pathname.endsWith("/classes")?{classes:created?[classroom]:[]}:{class:classroom}});
    });
    await page.goto("/#/classes");
    await expect(page.getByRole("heading",{name:"我的班级",exact:true})).toBeVisible();
    if(role==="teacher"){
      await page.getByRole("button",{name:"创建班级",exact:true}).click();
      const dialog=page.getByRole("dialog",{name:"创建班级",exact:true});
      await dialog.getByLabel("班级名称").fill("人工智能探索班");
      await dialog.getByRole("button",{name:"创建班级",exact:true}).click();
    } else {
      await expect(page.getByRole("button",{name:"创建班级",exact:true})).toHaveCount(0);
      await page.getByRole("button",{name:"加入班级",exact:true}).click();
      const dialog=page.getByRole("dialog",{name:"加入班级",exact:true});
      await dialog.getByLabel("邀请码").fill(code);
      await dialog.getByRole("button",{name:"加入班级",exact:true}).click();
    }
    await expect(page.getByRole("heading",{name:"人工智能探索班",exact:true})).toBeVisible();
    await expect(page.getByRole("article",{name:"林老师"})).toBeVisible();
    await expect(page.getByRole("article",{name:"陈老师"})).toBeVisible();
    await expect(page.getByRole("article",{name:"小芽"})).toBeVisible();
    await expect(page.getByText("private@example.com")).toHaveCount(0);
    if(role==="teacher"){
      await expect(page.getByRole("button",{name:"邀请成员",exact:true})).toHaveCount(0);
      await page.getByRole("link",{name:"管理班级",exact:true}).click();
      await expect(page.getByRole("heading",{name:"班级管理",exact:true})).toBeVisible();
      await page.getByRole("button",{name:"邀请成员",exact:true}).click();
      await expect(page.getByText(code,{exact:true})).toBeVisible();
      await page.getByRole("button",{name:"重置邀请码",exact:true}).click();
      await page.getByRole("dialog",{name:"重置邀请码？"}).getByRole("button",{name:"重置",exact:true}).click();
      await expect(page.getByText("QRSTUVWXYZABCDEF",{exact:true})).toBeVisible();
      await page.getByRole("button",{name:"关闭",exact:true}).click();
      await page.getByRole("link",{name:"返回班级面板",exact:true}).click();
    } else {
      await expect(page.getByRole("button",{name:"邀请成员",exact:true})).toHaveCount(0);
    }
    await page.reload();
    await expect(page.getByRole("heading",{name:"人工智能探索班",exact:true})).toBeVisible();
    await page.getByRole("button",{name:"返回班级",exact:true}).click();
    await expect(page.getByRole("link",{name:/人工智能探索班/})).toBeVisible();
    await page.setViewportSize({width:320,height:844});
    await page.emulateMedia({colorScheme:"dark"});
    await expect(page.getByRole("link",{name:/人工智能探索班/})).toBeVisible();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  });
}
