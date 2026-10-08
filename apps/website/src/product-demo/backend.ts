import { createFixtures, illustration } from './fixtures';
import type { CourseProjection, ProfileProjection } from '../../../client/src/domain/agent';
import type { ClassMember, Classroom } from '../../../client/src/features/classes/classes';
import type { CourseConversationState, QuestionPage, CodingExercise } from '../../../client/src/domain/learning';

type Session = { id: string; revision: number; state: (CourseProjection | ProfileProjection) & { commands: Record<string, { status: string }> } };
type Payload = Record<string, unknown>;

/** An in-memory adapter installed only in the isolated website demo document. */
export function installDemoBackend(scene: string, teacher: boolean) {
  const fixtures = createFixtures(scene, teacher);
  const { course, profile, deliverables } = fixtures;
  const user = { id: 'demo-user', nickname: teacher ? '林老师' : '小芽', role: teacher ? 'teacher' : 'student', email: 'demo@example.com', avatar: '' };
  const sessions = new Map<string, Session>();
  const sockets = new Set<DemoSocket>();
  let materialCount = 0;
  const members: ClassMember[] = [{ id: teacher ? user.id : 'head', nickname: '林老师', role: 'head_teacher', avatar: '' }, { id: 'teacher', nickname: '陈老师', role: 'teacher', avatar: '' }, { id: teacher ? 'student' : user.id, nickname: '小芽', role: 'student', avatar: '' }];
  const classes: Classroom[] = [{ id: 'demo-class', name: '五年级 · AI 探索', headTeacherId: members[0].id, headTeacherName: '林老师', memberCount: members.length, members }, { id: 'demo-class-2', name: '编程探索班', headTeacherId: members[0].id, headTeacherName: '林老师', memberCount: members.length, members: structuredClone(members) }];
  const classTemplate = structuredClone(classes[0]);
  const removed: ClassMember[] = [];
  let invite = 1;
  const sharing = { token: 'website-demo', visibility: 'private', classIds: [] as string[] };
  const originalFetch = window.fetch.bind(window);
  const response = (data: unknown, status = 200) => Response.json(data, { status });
  const snapshot = (session: Session) => ({ id: session.id, revision: session.revision, state: session.state });
  const publish = () => sockets.forEach(socket => socket.publish());
  let scrollPage = 'slides';
  window.addEventListener('zhiya-demo-scroll', event => {
    if (scene !== 'slides') return;
    const progress = (event as CustomEvent<{ progress: number }>).detail.progress;
    const next = ['slides', 'slides-2', 'slides-3'][Math.min(2, Math.floor(progress * 3))];
    if (next === scrollPage) return;
    scrollPage = next;
    course.state.currentPresentationId = next;
    const session = sessions.get('course');
    if (session && 'lesson' in session.state) {
      session.state.lesson = structuredClone(course.state);
      session.state.course = structuredClone(course);
      session.revision++;
      publish();
    }
  });

  function append(text: string) {
    course.state.messages.push({ id: course.state.messages.length + 1, role: 'assistant', text });
  }
  function execute(session: Session, action: string, args: unknown[]) {
    if ('conversation' in session.state) {
      if (action === 'run') {
        const text = String(args[0] ?? '');
        profile.messages.push({ role: 'user' }, { role: 'assistant', content: [{ type: 'text', text: '已根据你的说明更新示例背景。真实产品会通过自然对话确认具体需求。' }] });
        profile.memory += '\n\n- 本次说明：' + (text || '想先尝试，再看讲解');
        profile.memoryVersion++; profile.revision++; profile.correctionEnded = true;
      }
      session.state.conversation = structuredClone(profile);
      return;
    }
    const state = course.state;
    if (action === 'prompt') {
      const text = String(args[0] ?? '');
      state.messages.push({ id: state.messages.length + 1, role: 'user', text });
      if (/穿衣|修改|改成/.test(text)) {
        const page = state.pages.find(page => page.kind === 'slide');
        if (page?.kind === 'slide') { page.title = '天气冷了，怎么穿衣？'; page.markdown = '# 根据温度穿衣\n\n温度低 → 加一件外套；否则 → 轻装出门。'; state.currentPresentationId = page.id; }
        deliverables.forEach(item => { item.revision++; item.blocks[0].markdown = '# 条件判断\n\n温度低 → 加一件外套；否则 → 轻装出门。'; item.blocks[0].title = '天气冷了，怎么穿衣？'; });
        session.state.deliverablesChanged = (session.state.deliverablesChanged ?? 0) + 1;
        append('已把示例改成穿衣活动，课堂和文档已同步更新。');
      } else append('这是官网预设回复：我们把生活里的条件变成一个判断，再比较两个分支。可以继续翻页、做题或运行一行 print。');
    }
    if (action === 'selectPresentation') state.currentPresentationId = String(args[0]);
    if (action === 'selectDeliverable') session.state.deliverableSelection = { id: String(args[0]), blockId: String(args[1] ?? '') };
    const page = state.pages.find(page => page.id === args[0]);
    if (action === 'updateQuestion' && page?.kind === 'question') Object.assign(page, args[1] as Partial<QuestionPage>);
    if (action === 'updateCodingExercise' && page?.kind === 'coding') Object.assign(page, args[1] as Partial<CodingExercise>);
    if (action === 'submitQuestion' && page?.kind === 'question') { page.status = 'submitted'; append('答案已提交。接下来，对照条件判断的过程一起讨论。'); }
    if (action === 'deferQuestion') append('先继续讲解，之后可以回来练习。');
    if (action === 'requestExerciseReview') { if (page?.kind === 'coding') page.status = 'ended'; append('先观察输出，再对照代码看看每一步发生了什么。'); }
    session.state.lesson = structuredClone(state);
    session.state.course = structuredClone(course);
  }

  async function request(path: string, method: string, body: Payload) {
    const url = new URL(path, location.origin);
    path = url.pathname.replace(/^\/api/, '');
    if (path === '/me') return response(user);
    if (path === '/account-rules') return response({ password_min_characters: 8, password_max_bytes: 72, nickname_max_characters: 30, avatar_max_bytes: 3000000, avatar_max_dimension: 1024, verification_code_digits: 6, verification_ttl_seconds: 600 });
    if (path === '/learning/model') return response({ id: 'website-preset', available: true });
    if (path === '/socket-ticket') return response({ ticket: 'local-demo' });
    if (path === '/learning') return response(profile);
    if (path === '/courses') return response({ courses: [course] });
    if (path === '/agent/sessions') {
      const id = body.kind === 'profile' ? 'profile' : 'course';
      if (!sessions.has(id)) sessions.set(id, { id, revision: 1, state: body.kind === 'profile' ? { role: user.role as 'teacher' | 'student', busy: false, conversation: structuredClone(profile), commands: {} } : { role: user.role as 'teacher' | 'student', course: structuredClone(course), conversationId: course.conversationId, lesson: structuredClone(course.state), busy: false, generating: false, commands: {} } });
      return response(snapshot(sessions.get(id)!));
    }
    const command = path.match(/^\/agent\/sessions\/([^/]+)\/commands$/);
    if (command) {
      const session = sessions.get(command[1]);
      if (!session) return response({ error: '示例会话不存在' }, 404);
      if ('conversation' in session.state && body.action === 'run') {
        profile.correctionEnded = false; profile.revision++;
        session.state.conversation = structuredClone(profile); session.revision++; publish();
      }
      execute(session, String(body.action), Array.isArray(body.args) ? body.args : []);
      session.state.commands[String(body.requestId)] = { status: 'complete' };
      session.revision++; publish();
      return response({ ok: true }, 202);
    }
    if (path === '/code/languages') return response({ languages: [{ id: 71, name: 'Python' }] });
    if (path === '/code/runs') {
      const match = /^\s*print\(\s*(["'])(.*?)\1\s*\)\s*$/.exec(String(body.sourceCode));
      return response({ stdout: match ? match[2] + '\n' : '', stderr: match ? '' : '官网示例仅支持一行 print("文字")。', compileOutput: '', message: '', status: { description: match ? 'Accepted' : 'Runtime Error' }, time: '0.01', memory: 0 });
    }
    if (path.endsWith('/share')) { if (method === 'PUT') Object.assign(sharing, body); return response(sharing); }
    if (path.startsWith('/shares/')) return response({ deliverable: deliverables[1] });
    if (path.endsWith('/deliverables/import')) {
      materialCount++;
      const item = structuredClone(deliverables[0]); item.id = 'import-' + materialCount; item.title = '导入示例 PPT'; item.importNotes = ['官网使用预设导入结果，不上传文件。']; deliverables.push(item);
      return response({ deliverable: item });
    }
    if (path.endsWith('/deliverables')) return response({ deliverables });
    const deliverable = path.match(/^\/courses\/[^/]+\/deliverables\/([^/]+)$/);
    if (deliverable) {
      const item = deliverables.find(item => item.id === deliverable[1]);
      return item ? response({ deliverable: item }) : response({ error: '示例产物不存在' }, 404);
    }
    if (path.includes('/illustrations/') || path.includes('/deliverable-images/')) return response({ url: illustration });
    if (path.endsWith('/materials')) return response({ materials: [{ id: 'textbook', name: '编程入门教材.pdf', mediaType: 'application/pdf', sizeBytes: 1200, createdAt: course.createdAt }] });
    if (path.includes('/materials/') && path.endsWith('/content')) return response({ material: { id: 'textbook', name: '编程入门教材.pdf' }, revision: 1, excerpt: { status: 'ready', warnings: [], totalLines: 15, lines: [12, 13, 14, 15].map(number => ({ number, text: number === 12 ? '条件判断根据条件的真假，选择执行不同的语句。' : '下雨时带伞；晴天时直接出门。', kind: 'text', source: { page: 1 } })) } });
    if (path === '/courses/demo-course') { if (method === 'PATCH') Object.assign(course, body); return response({ course }); }
    if (path.endsWith('/conversation') && body.state) { Object.assign(course.state, body.state as CourseConversationState); return response({ course }); }
    if (path === '/classes') {
      if (method === 'POST') { const item = { ...structuredClone(classTemplate), id: 'created-' + Date.now(), name: String(body.name) }; classes.push(item); return response({ class: item }); }
      return response({ classes });
    }
    if (path === '/classes/join') { if (!classes.length) classes.push(structuredClone(classTemplate)); return response({ class: classes[0] }); }
    const classMatch = path.match(/^\/classes\/([^/]+)(.*)$/);
    if (classMatch) {
      const item = classes.find(item => item.id === classMatch[1]);
      const suffix = classMatch[2];
      if (!item) return response({ error: '示例班级不存在' }, 404);
      if (suffix === '/invitation') { if (method === 'POST') invite++; return response({ code: 'ZHIYA0' + invite }); }
      if (suffix === '/removed-members') return response({ members: removed });
      if (suffix.startsWith('/removed-members/')) { removed.splice(0); return response({ ok: true }); }
      if (suffix.startsWith('/members/') && method === 'DELETE') { const member = item.members?.find(member => member.id === suffix.split('/')[2]); if (member) { removed.push(member); item.members = item.members?.filter(entry => entry.id !== member.id); item.memberCount = item.members?.length ?? 0; } }
      if (suffix === '/transfer') { item.headTeacherId = String(body.memberId); item.members?.forEach(member => { member.role = member.id === item.headTeacherId ? 'head_teacher' : member.role === 'head_teacher' ? 'teacher' : member.role; }); item.headTeacherName = item.members?.find(member => member.id === item.headTeacherId)?.nickname ?? ''; invite++; }
      if (method === 'PATCH') item.name = String(body.name);
      if ((method === 'DELETE' && !suffix) || suffix === '/leave') classes.splice(classes.indexOf(item), 1);
      if (suffix === '/shares') return response({ shares: [{ token: 'website-demo', title: '条件判断 · 教案与学习材料', kind: 'document', teacherName: '陈老师', updatedAt: course.updatedAt }] });
      return response({ class: item, ok: true });
    }
    return response({ error: '此操作不在官网预设演示范围内，不会连接真实服务。' }, 400);
  }

  window.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input), location.href);
    if (url.pathname.startsWith('/api/')) {
      const text = init?.body ?? (input instanceof Request ? await input.text() : '');
      return request(url.href, init?.method ?? (input instanceof Request ? input.method : 'GET'), typeof text === 'string' && text ? JSON.parse(text) as Payload : {});
    }
    if (url.origin === location.origin || ['data:', 'blob:'].includes(url.protocol)) return originalFetch(input, init);
    throw new Error('官网演示不会连接外部服务。');
  };

  class DemoSocket extends EventTarget {
    static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3;
    readyState = 0;
    onmessage: ((event: MessageEvent) => void) | null = null;
    onopen: (() => void) | null = null;
    onclose: (() => void) | null = null;
    onerror: (() => void) | null = null;
    readonly url: string;
    constructor(url: string | URL) {
      super(); this.url = String(url); sockets.add(this);
      window.setTimeout(() => { if (this.readyState !== 0) return; this.readyState = 1; this.onopen?.(); this.publish(); }, 0);
    }
    deliver(data: unknown) { const event = new MessageEvent('message', { data: JSON.stringify(data) }); this.onmessage?.(event); this.dispatchEvent(event); }
    publish() {
      if (this.readyState !== 1) return;
      const path = new URL(this.url).pathname;
      const match = path.match(/^\/api\/agent\/sessions\/([^/]+)\/socket$/);
      if (match && sessions.has(match[1])) this.deliver(snapshot(sessions.get(match[1])!));
      if (path === '/api/learning/socket') this.deliver({ type: 'snapshot', state: profile });
      if (path === '/api/agent/socket') this.deliver({ sessions: [], conversations: [] });
    }
    send(raw: string) {
      const input = JSON.parse(raw) as { requestId: string };
      this.deliver({ type: 'response', requestId: input.requestId, state: profile });
    }
    close() { if (this.readyState === 3) return; this.readyState = 3; sockets.delete(this); }
  }
  Object.defineProperty(window, 'WebSocket', { value: DemoSocket, configurable: true });
  if (navigator.mediaDevices) Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { value: async () => { throw new Error('官网语音演示使用预设内容，不采集麦克风。'); } });
}
