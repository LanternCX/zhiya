"""Headless turtle subset for static browser results. Runs only inside go-judge."""
import atexit
import math
from html import escape

_ITEMS = []
_TURTLES = []
_MAX_ITEMS = 10000
_SIZE = [640, 480]
_BACKGROUND = 'white'
_COLOR_MODE = 1.0

def _number(value):
    value = float(value)
    if not math.isfinite(value) or abs(value) > 1000000:
        raise ValueError('绘图数值须为有限数值，绝对值不超过 1000000')
    return value

def _color(args):
    value = args[0] if len(args) == 1 else args
    if isinstance(value, str):
        if len(value) > 80 or not value or not (value.replace(' ', '').isalpha() or (value.startswith('#') and len(value) in (4,7,9) and all(c in '0123456789abcdefABCDEF' for c in value[1:]))):
            raise ValueError('颜色请使用英文名称、十六进制色值或 RGB 数值')
        return value
    if len(value) != 3: raise ValueError('RGB 颜色需要三个数值')
    channels = [_number(c) for c in value]
    if any(c < 0 or c > _COLOR_MODE for c in channels): raise ValueError('RGB 颜色超出 colormode 范围')
    return '#%02x%02x%02x' % tuple(round(c / _COLOR_MODE * 255) for c in channels)

def _item(owner, tag, attrs, text=None):
    if len(_ITEMS) >= _MAX_ITEMS: raise RuntimeError('图形过于复杂：最多 10000 个绘图元素')
    size = len(escape(text or '').encode()) + sum(len(escape(str(v),quote=True).encode()) + len(k) + 4 for k,v in attrs.items()) + 2*len(tag)+6
    if sum(item[4] for item in _ITEMS) + size > 900000: raise RuntimeError('图形超过大小限制，请减少绘图内容')
    _ITEMS.append((owner, tag, attrs, text, size))

def _save():
    if not _TURTLES: return
    bounds = [(-_SIZE[0]/2,-_SIZE[1]/2),(_SIZE[0]/2,_SIZE[1]/2)]
    for t in _TURTLES: bounds.extend(t._bounds)
    left=min(x for x,y in bounds)-20; top=min(y for x,y in bounds)-20
    width=max(x for x,y in bounds)-left+20; height=max(y for x,y in bounds)-top+20
    body=[]
    for _,tag,attrs,text,_ in _ITEMS:
        attributes=' '.join(f'{key}="{escape(str(value),quote=True)}"' for key,value in attrs.items())
        body.append(f'<{tag} {attributes}>' + escape(text or '') + f'</{tag}>')
    svg=f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{left} {top} {width} {height}" width="{_SIZE[0]}" height="{_SIZE[1]}" role="img"><rect x="{left}" y="{top}" width="{width}" height="{height}" fill="{escape(_BACKGROUND,quote=True)}"/>' + ''.join(body) + '</svg>'
    if len(svg.encode()) > 1000000: raise RuntimeError('绘图结果超过 1MB，请减少绘图内容')
    with open('zhiya-turtle.svg','w',encoding='utf-8') as output: output.write(svg)

class Turtle:
    def __init__(self, shape='classic', undobuffersize=1000, visible=True):
        self._x=self._y=self._heading=0.0
        self._down=True; self._pen='black'; self._fill='black'; self._width=1
        self._bounds=[]; self._polygon=None; self._visible=visible
        _TURTLES.append(self)
    def goto(self, x, y=None):
        if y is None: x,y=x
        x,y=_number(x),_number(y)
        if self._down:
            _item(self,'line',dict(x1=self._x,y1=-self._y,x2=x,y2=-y,stroke=self._pen,**{'stroke-width':self._width,'stroke-linecap':'round'}))
            self._bounds.extend([(self._x-self._width,-self._y-self._width),(self._x+self._width,-self._y+self._width),(x-self._width,-y-self._width),(x+self._width,-y+self._width)])
        if self._polygon is not None: self._polygon.append((x,-y))
        self._x,self._y=x,y
    setpos=setposition=goto
    def forward(self, distance):
        d=_number(distance); a=math.radians(self._heading)
        self.goto(self._x+d*math.cos(a),self._y+d*math.sin(a))
    fd=forward
    def backward(self,distance):self.forward(-_number(distance))
    bk=back=backward
    def left(self,angle):self._heading=(self._heading+_number(angle))%360
    lt=left
    def right(self,angle):self.left(-_number(angle))
    rt=right
    def setheading(self,angle):self._heading=_number(angle)%360
    seth=setheading
    def heading(self):return self._heading
    def position(self):return (self._x,self._y)
    pos=position
    def xcor(self):return self._x
    def ycor(self):return self._y
    def setx(self,x):self.goto(x,self._y)
    def sety(self,y):self.goto(self._x,y)
    def home(self):self.goto(0,0);self.setheading(0)
    def penup(self):self._down=False
    up=pu=penup
    def pendown(self):self._down=True
    down=pd=pendown
    def isdown(self):return self._down
    def pensize(self,width=None):
        if width is None:return self._width
        width=_number(width)
        if not 0 < width <= 1000:raise ValueError('线宽须在 0 到 1000 之间')
        self._width=width
    width=pensize
    def pencolor(self,*args):
        if not args:return self._pen
        self._pen=_color(args)
    def fillcolor(self,*args):
        if not args:return self._fill
        self._fill=_color(args)
    def color(self,*args):
        if not args:return self._pen,self._fill
        if len(args)==2:self.pencolor(args[0]);self.fillcolor(args[1])
        else:self.pencolor(*args);self.fillcolor(*args)
    def begin_fill(self):
        self._polygon=[(self._x,-self._y)];self._fill_index=len(_ITEMS)
    def end_fill(self):
        if self._polygon is None:return
        _item(self,'polygon',dict(points=' '.join(f'{x},{y}' for x,y in self._polygon),fill=self._fill,stroke='none'))
        item=_ITEMS.pop();_ITEMS.insert(min(self._fill_index,len(_ITEMS)),item)
        self._polygon=None
    def filling(self):return self._polygon is not None
    def circle(self,radius,extent=None,steps=None):
        radius=_number(radius);extent=360 if extent is None else _number(extent)
        if abs(extent)>3600:raise ValueError('圆弧角度过大')
        count=max(1,int(abs(extent)/4)+1) if steps is None else int(steps)
        if not 1<=count<=2000:raise ValueError('圆弧步数须在 1 到 2000 之间')
        start=math.radians(self._heading);x,y=self._x,self._y
        cx=x-radius*math.sin(start);cy=y+radius*math.cos(start)
        sweep=math.radians(extent)*(1 if radius>=0 else -1)
        for i in range(1,count+1):
            a=sweep*i/count
            self.goto(cx+(x-cx)*math.cos(a)-(y-cy)*math.sin(a),cy+(x-cx)*math.sin(a)+(y-cy)*math.cos(a))
        self.left(math.degrees(sweep))
    def dot(self,size=None,*color):
        size=max(self._width+4,2*self._width) if size is None else _number(size)
        if not 0<size<=2000:raise ValueError('点的直径须在 0 到 2000 之间')
        _item(self,'circle',dict(cx=self._x,cy=-self._y,r=size/2,fill=_color(color) if color else self._pen))
        self._bounds.extend([(self._x-size/2,-self._y-size/2),(self._x+size/2,-self._y+size/2)])
    def write(self,arg,move=False,align='left',font=('Arial',12,'normal')):
        if move:raise NotImplementedError('网页绘图的 write 暂不支持 move=True')
        if align not in ('left','center','right'):raise ValueError('align 须为 left、center 或 right')
        text=str(arg);size=_number(font[1])
        if not 1<=size<=200 or len(text)>2000:raise ValueError('绘图文字或字号超出限制')
        _item(self,'text',{'x':self._x,'y':-self._y,'fill':self._pen,'font-family':str(font[0])[:100],'font-size':size,'font-weight':'bold' if 'bold' in str(font[2]) else 'normal','text-anchor':{'left':'start','center':'middle','right':'end'}[align]},text)
        span=len(text)*size
        left=self._x if align=='left' else self._x-span if align=='right' else self._x-span/2
        self._bounds.extend([(left,-self._y-size),(left+span,-self._y+size)])
    def clear(self):
        _ITEMS[:]=[item for item in _ITEMS if item[0] is not self]
        self._bounds=[];self._polygon=None
    def reset(self):
        self.clear();self._x=self._y=self._heading=0.0
        self._down=True;self._pen=self._fill='black';self._width=1
    def speed(self,speed=None):return 0
    def hideturtle(self):self._visible=False
    ht=hideturtle
    def showturtle(self):self._visible=True
    st=showturtle
    def isvisible(self):return self._visible
    def getscreen(self):return Screen()
    def __getattr__(self,name):raise NotImplementedError(f'网页静态绘图暂不支持 turtle.{name}；请使用基本移动、转向和画笔命令')

class _Screen:
    def __getattr__(self,name):
        if name in ('setup','bgcolor','title','tracer','update','colormode','done','mainloop','exitonclick'):return globals()[name]
        raise NotImplementedError(f'网页静态绘图暂不支持 Screen.{name}；不支持鼠标、键盘、定时器和桌面窗口')
_SCREEN=_Screen()
def Screen():return _SCREEN
def setup(width=640,height=480,startx=None,starty=None):
    for i,v in enumerate((width,height)):
        v=_number(v)
        if 0<v<=1:v*= (640,480)[i]
        if not 100<=v<=2048:raise ValueError('画布尺寸须在 100 到 2048 之间')
        _SIZE[i]=v
    _default()
def bgcolor(*args):
    global _BACKGROUND
    if not args:return _BACKGROUND
    _BACKGROUND=_color(args);_default()
def colormode(mode=None):
    global _COLOR_MODE
    if mode is None:return _COLOR_MODE
    if mode not in (1,1.0,255):raise ValueError('colormode 只支持 1.0 或 255')
    _COLOR_MODE=mode

def title(text):pass
def tracer(n=None,delay=None):return 0
def update():pass
def done():_save()
mainloop=exitonclick=done
_DEFAULT=None
def _default():
    global _DEFAULT
    if _DEFAULT is None:_DEFAULT=Turtle()
    return _DEFAULT

def __getattr__(name):
    if name.startswith('_'):raise AttributeError(name)
    if hasattr(Turtle,name):return getattr(_default(),name)
    raise NotImplementedError(f'网页静态绘图暂不支持 turtle.{name}；不支持桌面窗口与交互事件')
__all__=['Turtle','Screen','setup','bgcolor','colormode','title','tracer','update','done','mainloop','exitonclick']+[n for n in dir(Turtle) if not n.startswith('_')]
atexit.register(_save)
