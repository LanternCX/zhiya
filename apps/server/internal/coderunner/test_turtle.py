import pathlib, subprocess, sys, tempfile, unittest, xml.etree.ElementTree as ET
MODULE = pathlib.Path(__file__).with_name('turtle.py')
NS = {'s':'http://www.w3.org/2000/svg'}
CUBE = '''import turtle
print('drawing')
t = turtle.Turtle()
t.pensize(2)
for x,y in [(0,0),(60,60)]:
    t.penup(); t.goto(x,y); t.pendown()
    for i in range(4):
        t.forward(120); t.left(90)
for x,y in [(0,0),(120,0),(120,120),(0,120)]:
    t.penup(); t.goto(x,y); t.pendown(); t.goto(x+60,y+60)
turtle.done()
'''
def run(source):
    with tempfile.TemporaryDirectory() as tmp:
        d=pathlib.Path(tmp)
        if MODULE.exists(): (d/'turtle.py').write_bytes(MODULE.read_bytes())
        (d/'source.py').write_text(source)
        r=subprocess.run([sys.executable,'source.py'],cwd=d,capture_output=True,text=True,timeout=5)
        f=d/'zhiya-turtle.svg'
        return r, ET.fromstring(f.read_text()) if f.exists() else None
class TurtleOutputTest(unittest.TestCase):
    def test_cube_has_twelve_edges_and_keeps_stdout(self):
        result, svg = run(CUBE)
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertEqual(result.stdout,'drawing\n')
        self.assertIsNotNone(svg)
        lines=svg.findall('.//s:line',NS)
        self.assertEqual(len(lines),12)
        self.assertEqual([float(lines[0].get(k)) for k in ('x1','y1','x2','y2')],[0,0,120,0])
        self.assertEqual([float(lines[-1].get(k)) for k in ('x1','y1','x2','y2')],[0,-120,60,-180])
    def test_color_fill_circle_and_labels(self):
        r,svg=run("from turtle import *\ncolor('red','gold')\nbegin_fill()\nfor i in range(3):\n forward(60);left(120)\nend_fill()\npenup();goto(-100,0);pendown();circle(30)\nwrite('<script>你好</script>')\ndot(8,'blue')\n")
        self.assertEqual(r.returncode,0,r.stderr)
        self.assertEqual(svg.find('.//s:polygon',NS).get('fill'),'gold')
        self.assertIsNotNone(svg.find('.//s:circle',NS))
        self.assertEqual(svg.find('.//s:text',NS).text,'<script>你好</script>')
        self.assertIsNone(svg.find('.//s:script',NS))
    def test_clear_and_unsupported_events(self):
        r,svg=run("import turtle\nt=turtle.Turtle()\nt.forward(50)\nt.clear()\nt.goto(100,0)\n")
        self.assertEqual(r.returncode,0,r.stderr)
        self.assertEqual(len(svg.findall('.//s:line',NS)),1)
        r,svg=run("import turtle\nturtle.Screen().onclick(lambda x,y:None)\n")
        self.assertNotEqual(r.returncode,0)
        self.assertIn('NotImplementedError',r.stderr)
        self.assertIn('Screen.onclick',r.stderr)
if __name__=='__main__':unittest.main()
