import teacher from './fixtures.json';
import {learningReplies,learningNotes} from './student-content';

// Editorial mock conversations use existing product schemas and captured assets.
// They are replay data, not a transcript of a live model evaluation.
export const studentMode=new URLSearchParams(location.search).get('audience')==='student';
export const studentKnowledge={version:'a'.repeat(64),blockId:'variables-output',documentId:'student-reference',title:'Python 入门学习资料',modality:'text',location:{},text:'Python 中，赋值语句把名字绑定到一个对象。baozi_price = 2 本身不会显示数字。执行 print(baozi_price) 才会把当前值显示到输出中。把赋值改成 baozi_price = 3，再输出会看到 3。',warnings:[],citation:`[Python 入门学习资料](#knowledge/${'a'.repeat(64)}/variables-output)`,score:0.9,hasAsset:false};
export const studentSpeech='我上初一，没有学过编程。我想做一个食堂点餐程序，请从变量、输入和输出开始教我。';
export const studentMemory='# 我的学习档案\n\n## 当前起点\n- 初中一年级，第一次学习 Python。\n- 认识键盘和文字输入，还没有独立写过程序。\n\n## 学习目标\n- 用变量、输入和输出完成一个食堂点餐小程序。\n\n## 表达与互动偏好\n- 先用生活中的例子，再看简短代码。\n- 喜欢操作动画、预测结果，再运行验证。\n- 不理解时希望换一种解释，先不要引入循环和函数。\n\n## 可以修改\n这些信息可以随时通过对话补充、修改或要求忘记。';
export const studentDialogs:Record<string,{prompt:string;reply:string}>={
  generate:{prompt:'我上初一，第一次学 Python。请用食堂点餐，教我变量、输入和输出。先给我一个学习安排，再生成三个简短的讲解页。',reply:'我们先学三件事：用 print 显示一句话，给数据起名字，再用 input 接收输入。每学一步就动手试一次。讲解页正在依次生成，你可以随时提问，也可以要求换一个例子。'},
  revision:{prompt:'变量还是没听懂。能不能只用一句解释、一行代码，再问我一个问题？',reply:'变量名让我们可以再次取用一个值。看这一行：baozi_price = 2。以后写 baozi_price，就能取到这个值。如果把 2 改成 3，再输出 baozi_price，你预测会看到什么？'},
  animation:{prompt:'输入、变量、输出是什么关系？让我一步一步点着看。',reply:'先点击输入，顾客说出需要的份数；再点击存入变量，观察数据放到哪里；最后点击输出。每次只看一步，你来控制继续的时机。'},
  practice:{prompt:'给我一个可以直接运行的小练习。报错的时候，先给提示，让我自己修改。',reply:'先运行欢迎词，再补一行介绍自己的名字。看到错误时，先检查引号和括号是否配对。改好以后再次运行，对照输出，看看程序是否按照你的想法工作。'},
  question:{prompt:'我想检查一下自己是否理解变量。',reply:'你把赋值和输出混在一起了。baozi_price = 2 给一个值绑定名字；让屏幕显示结果需要 print。我们先不增加新知识，回到一个更小的例子：只改变变量的值，再观察输出。'},
  illustration:{prompt:'用一张食堂点餐的图，帮我把刚才的三个概念对应起来。',reply:'顾客告诉窗口需要几份，这是输入；程序用变量保留这次输入；把结果显示出来，这是输出。先观察画面，再说说每一步对应哪个概念。'},
  document:{prompt:'把这一节整理成学习笔记，保留代码、我容易混淆的地方和下一步练习。',reply:'学习笔记已经整理到右侧：三个概念、可运行的代码，以及赋值和输出的区别。你可以继续修改、分享或导出。下次回来，也可以从课程小节和这段对话继续。'},
  sharing:{prompt:'我想把这份学习笔记分享给同班同学。',reply:'打开笔记的分享设置，选择班级并保存。分享的是这份材料，个人对话和学习档案不会一起开放。'},
  export:{prompt:'我还想下载学习笔记和课堂课件，留着复习。',reply:'在导出与分享菜单里选择对应格式，就能保存文件。课堂课件可以下载为 PPT，学习笔记可以下载为 Word。'},
};
for(const [key,reply] of Object.entries(learningReplies))if(studentDialogs[key])studentDialogs[key].reply=reply;
export function makeStudentFixture(){
  const data=structuredClone(teacher);
  Object.assign(data.user,{role:'student',nickname:'小芽同学',email:'student@example.invalid'});
  data.course.role='student';data.profile.role='student';data.onboarding.role='student';
  for(const [id,key] of [[7,'generate'],[19,'revision'],[25,'practice'],[33,'illustration']] as const){const message=data.course.lesson.messages.find(m=>m.id===id);if(message)message.text=studentDialogs[key].prompt}
  data.profile.conversation.memory=studentMemory;
  data.onboarding.conversation.question!.text='你现在处在哪个学习阶段？也可以直接告诉我你的基础。';
  data.onboarding.conversation.question!.options=['小学低年级','小学高年级','初中','高中','我想直接说明'];
  const names=['我的学习目标','变量、输入与输出','一步一步看数据流动','动手编程与巩固','学习笔记与复习'];
  data.course.course.topic='从零开始学习 Python，用食堂点餐理解变量、输入和输出。先观察例子，再预测结果，最后写代码验证；不懂的地方随时追问，根据反馈调整学习。';
  const objectives=['说明自己的基础、兴趣与目标，确定适合当前起点的学习安排。','区分给值起名字、接收输入和显示输出，用简短代码验证。','通过分步动画观察输入的数据怎样被保存、取用与输出。','补全代码并运行；根据报错修改，根据答题反馈复习易混概念。','整理概念与代码，保留学习记录，按需要继续或复习。'];
  data.course.course.sections.forEach((s,i)=>{s.title=names[i]??s.title;s.objective=objectives[i]??s.objective;s.conversations.forEach(c=>{c.title='我的 Python 入门学习'})});
  const blocks=[
    {id:'learning-goal',title:'这一节我要学会什么',markdown:'从零开始，用 **变量、输入和输出** 写一个小程序。\n\n1. 先预测屏幕会显示什么。\n2. 修改一行代码，运行验证。\n3. 能用自己的话区分赋值和输出。',imageIds:[]},
    {id:'learning-code',title:'三个概念，一段代码',markdown:'```python\nname = input("你叫什么名字？")\nprint("欢迎你，" + name)\n```\n\n- `input`：接收输入。\n- `name`：再次取用输入的值。\n- `print`：把结果显示出来。',imageIds:[]},
    {id:'learning-review',title:'容易混淆的地方',markdown:'`baozi_price = 2` 不会自动显示数字。\n\n想看结果，还要写 `print(baozi_price)`。\n\n**自己试一试**：把 2 改成 3，先预测，再运行。\n\n**下一步**：能说清区别后，再练习接收顾客的输入。',imageIds:[]},
  ];
  data.deliverables.deliverables.forEach(d=>{d.title=d.kind==='document'?'Python 入门 · 我的学习笔记':'Python 入门 · 我的课堂课件';if(d.kind==='document')d.blocks=structuredClone(learningNotes);else if(d.blocks?.[0])Object.assign(d.blocks[0],blocks[0])});
  return data;
}
