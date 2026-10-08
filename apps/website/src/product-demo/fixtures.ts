import type { Conversation } from '../../../client/src/domain/conversation';
import type { CourseConversationState, LessonPage, StoredCourse } from '../../../client/src/domain/learning';
import type { Deliverable } from '../../../client/src/domain/deliverable';

const date = '2026-10-01T08:00:00Z';
export const illustration = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 540"><rect width="960" height="540" fill="#e1ebd5"/><circle cx="750" cy="120" r="65" fill="#edca78"/><path d="M0 440Q200 310 480 440T960 440V540H0Z" fill="#9cbd91"/><path d="M480 470V275M480 345Q300 350 350 220Q505 235 480 345M480 295Q465 155 605 170Q625 285 480 295" fill="#58825d" stroke="#285334" stroke-width="12"/><text x="50" y="70" font-size="32" fill="#285334">小芽的天气故事</text></svg>');

export function lessonPages(): LessonPage[] {
  return [
    { kind: 'slide', id: 'materials', title: '从生活到条件判断', markdown: '# 下雨了，要带伞吗？\n\n先观察，再判断，最后做出选择。\n\n- 下雨 → 带伞\n- 晴天 → 直接出门' },
    { kind: 'slide', id: 'slides', title: '把天气变成一个条件', markdown: '# 条件，就像岔路口\n\n**下雨了吗？**\n\n答案是“是”或“否”，行动也因此不同。' },
    { kind: 'animation', id: 'animation', title: '条件判断的过程', layout: 'vertical', nodes: [{ id: 'start', shape: 'circle', label: '准备出门' }, { id: 'condition', shape: 'diamond', label: '下雨了吗？' }, { id: 'rain', shape: 'rectangle', label: '带上雨伞' }, { id: 'sun', shape: 'rectangle', label: '直接出门' }], edges: [{ id: 'check', source: 'start', target: 'condition', arrow: true }, { id: 'yes', source: 'condition', target: 'rain', label: '是', arrow: true }, { id: 'no', source: 'condition', target: 'sun', label: '否', arrow: true }], buttons: [{ id: 'rain', label: '下雨的情况', steps: [[{ type: 'highlight', targetId: 'condition' }], [{ type: 'flow', targetId: 'yes' }], [{ type: 'highlight', targetId: 'rain' }]] }, { id: 'sun', label: '晴天的情况', steps: [[{ type: 'highlight', targetId: 'condition' }], [{ type: 'flow', targetId: 'no' }], [{ type: 'highlight', targetId: 'sun' }]] }] },
    { kind: 'illustration', id: 'illustration', title: '小芽的天气故事', alt: '小芽在花园中观察天气', assetId: 'sprout' },
    { kind: 'video', id: 'video', bvid: 'BV1xx411c7mD', title: '条件判断 · 从生活到代码', topic: '条件判断', description: '官网本地视频预设画面', author: '示例课堂', duration: '03:20', playCount: -1, publishedAt: 0 },
    { kind: 'question', id: 'question', title: '做一个选择', text: '下雨时，哪条分支会被执行？', questionKind: 'single', options: ['带上雨伞', '直接出门'], selected: [], answerText: '', status: 'active' },
    { kind: 'coding', id: 'coding', title: '第一行 Python', instructions: '修改引号里的文字，运行你的第一行代码。官网预设运行器仅支持一行 print。', languageId: 71, languageName: 'Python', starterCode: 'print("你好，知芽！")', code: 'print("你好，知芽！")', stdin: '', status: 'active' },
    { kind: 'slide', id: 'voice', title: '说出来，也随时插一句', markdown: '# 语音与课堂，一起推进\n\n你：可以换个例子吗？\n\n知芽：我们来看看根据温度穿衣服。\n\n> 官网演示使用预设文字，不采集麦克风、不播放真实语音。' },
    { kind: 'slide', id: 'continue', title: '回到上次的课堂', markdown: '# 接着昨天的好奇\n\n课堂页、代码和最近对话仍保留在同一个学习空间里。' },
    { kind: 'slide', id: 'slides-2', title: '把判断写成两条分支', markdown: '# 两种情况，两条路\n\n**如果下雨** → 带上雨伞。\n\n**否则** → 直接出门。' },
    { kind: 'slide', id: 'slides-3', title: '在生活中找到另一个条件', markdown: '# 轮到你来找条件\n\n天气冷了，怎么穿衣？\n\n观察温度，再决定是否加一件外套。' },
  ];
}

export function createFixtures(scene: string, teacher: boolean) {
  const pages = lessonPages();
  const selected = pages.some(page => page.id === scene) ? scene : 'materials';
  const state: CourseConversationState = { messages: [
    { id: 1, role: 'user', text: teacher ? '给五年级准备一节条件判断课，包含活动和课后材料。' : '用生活中的例子，讲讲条件判断。' },
    { id: 2, role: 'assistant', text: '我们从“下雨要不要带伞”开始。条件判断依据条件的真假选择不同分支。参考[编程入门教材](#material/textbook/1/12-15)。你可以操作右侧课堂，也可以继续提问。' },
  ], pages, presentations: pages.map(page => ({ id: page.id, pageId: page.id })), currentPresentationId: selected };
  const course: StoredCourse = { id: 'demo-course', conversationId: 'demo-conversation', title: '从生活到编程', topic: '条件判断', cover: { motif: 'code', palette: 'sprout', label: '从生活到编程' }, status: 'active', state, sections: [{ id: 'demo-section', title: '认识条件判断', objective: '从具体选择理解条件与分支', position: 0, status: 'active', conversations: [{ id: 'demo-conversation', sectionId: 'demo-section', title: '条件判断的第一课', state, createdAt: date, updatedAt: date }] }], createdAt: date, updatedAt: date };
  const profile: Conversation = { id: 'demo-profile', purpose: 'onboarding', messages: [{ role: 'assistant', content: [{ type: 'text', text: '你好！聊聊你已经学过什么、喜欢怎样学习。我们可以从一个具体的问题开始。' }] }], completed: true, correctionEnded: true, memory: teacher ? '# 教学背景\n\n- 授课对象：小学五年级\n- 准备目标：条件判断入门课\n- 偏好：教学思路、课件与教案' : '# 学习背景\n\n- 年级：小学五年级\n- 编程基础：初学者\n- 偏好：先看生活里的例子，再动手尝试', memoryVersion: 1, messageSequence: 1, revision: 1, status: 'idle', leaseUntil: '', question: null };
  const deliverables: Deliverable[] = [{ id: 'demo-slides', kind: 'presentation', title: '条件判断 · 课堂课件', source: 'classroom', revision: 1, updatedAt: date, blocks: [{ id: 'b1', title: '下雨了，要带伞吗？', markdown: '# 条件判断\n\n下雨 → 带伞；否则 → 直接出门。', imageIds: [] }, { id: 'b2', title: '动手试一试', markdown: '根据温度决定怎样穿衣。', imageIds: [] }] }, { id: 'demo-document', kind: 'document', title: '条件判断 · 教案与学习材料', source: 'course-document', revision: 1, updatedAt: date, blocks: [{ id: 'doc1', title: '教学目标与活动', markdown: '# 条件判断入门\n\n## 教学目标\n认识条件和分支。\n\n## 课堂活动\n观察天气，决定是否带伞。\n\n## 课后延伸\n找一个生活中的条件判断。', imageIds: [] }] }];
  return { course, profile, deliverables };
}
