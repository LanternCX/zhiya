import captured from './class-sharing.json';

// The captured teacher/student verified access; the remaining roster is demo data.
const names=['林知夏','陈子安','王明宇','李欣然','周予宁','赵一诺','吴思远','郑可欣','孙景行','许书瑶','何沐阳','高梓涵','罗嘉言','梁星辰','宋雨桐','唐亦凡','谢语彤','韩逸晨','曹若溪','邓承泽','冯安然','蒋乐知','沈清禾'];
const members=[...captured.classroom.class.members,...names.map((nickname,i)=>({id:`demo-student-${i}`,nickname,avatar:'',role:'student'}))];
export const sharing={...captured,classroom:{class:{...captured.classroom.class,members,memberCount:members.length}},classes:{classes:captured.classes.classes.map(c=>c.id===captured.classroom.class.id?{...c,memberCount:members.length}:c)}};
