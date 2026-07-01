# Markdown 和 LaTeX 测试文章

## 1. 标题测试

### 三级标题

#### 四级标题

##### 五级标题

###### 六级标题

---

## 2. 段落与格式

这是一段普通文本，**加粗文本**，*斜体文本*，***加粗斜体***。

~~删除线文本~~，<u>下划线文本</u>，`行内代码`。

> 这是一段引用文本。
> 
> 嵌套引用。

---

## 3. 列表

### 无序列表

- 项目一
- 项目二
  - 子项目 A
  - 子项目 B
- 项目三

### 有序列表

1. 第一步
2. 第二步
   1. 子步骤 2.1
   2. 子步骤 2.2
3. 第三步

### 任务列表

- [x] 已完成任务
- [ ] 未完成任务
- [ ] 进行中任务

---

## 4. 代码块

### JavaScript

```javascript
function hello(name) {
  console.log(`Hello, ${name}!`);
  return true;
}
```

### Python

```python
def fibonacci(n):
    if n <= 1:
        return n
    return fibonacci(n-1) + fibonacci(n-2)
```

### CSS

```css
.container {
  display: flex;
  justify-content: center;
  align-items: center;
}
```

---

## 5. 表格

| 功能 | Markdown | LaTeX |
|------|----------|-------|
| 粗体 | `**text**` | `\textbf{text}` |
| 斜体 | `*text*` | `\textit{text}` |
| 公式 | - | `$E=mc^2$` |

---

## 6. 链接与图片

[点击访问百度](https://www.baidu.com)

![示例图片](https://picsum.photos/seed/test/400/300)

---

## 7. 水平线

---

***

---

## 8. LaTeX 数学公式

### 行内公式

爱因斯坦质能方程：$E = mc^2$

勾股定理：$a^2 + b^2 = c^2$

### 上下标

上标：$x^2$, $a^n$, $e^{i\pi}$

下标：$x_1$, $H_2O$, $a_{ij}$

混合：$x_{i}^{2}$, $e^{-x^2}$

### 分数

$\frac{1}{2}$, $\frac{a+b}{c+d}$, $\frac{x^2}{y^3}$

### 根号

$\sqrt{2}$, $\sqrt{x^2 + y^2}$, $\sqrt[3]{8}$

### 求和与积分

求和：$\sum_{i=1}^{n} i = \frac{n(n+1)}{2}$

积分：$\int_{0}^{\infty} e^{-x} dx = 1$

多重积分：$\iint_{D} f(x,y) dxdy$

### 极限

$\lim_{x \to 0} \frac{\sin x}{x} = 1$

$\lim_{n \to \infty} (1 + \frac{1}{n})^n = e$

### 三角函数

$\sin^2 x + \cos^2 x = 1$

$\tan x = \frac{\sin x}{\cos x}$

$\sin(\alpha + \beta) = \sin\alpha\cos\beta + \cos\alpha\sin\beta$

### 对数

$\log_2 8 = 3$

$\ln e = 1$

$\log_a b = \frac{\ln b}{\ln a}$

### 矩阵

$$
\begin{pmatrix}
1 & 2 & 3 \\
4 & 5 & 6 \\
7 & 8 & 9
\end{pmatrix}
$$

$$
\begin{bmatrix}
a & b \\
c & d
\end{bmatrix}
$$

### 行列式

$$
\det\begin{pmatrix}
a & b \\
c & d
\end{pmatrix} = ad - bc
$$

### 向量

$\vec{a} = (a_1, a_2, a_3)$

$\vec{u} \cdot \vec{v} = |\vec{u}||\vec{v}|\cos\theta$

### 希腊字母

$\alpha \beta \gamma \delta \epsilon \zeta \eta \theta$

$\iota \kappa \lambda \mu \nu \xi \pi \rho$

$\sigma \tau \upsilon \phi \chi \psi \omega$

$\Gamma \Delta \Theta \Lambda \Xi \Pi \Sigma$

$\Upsilon \Phi \Psi \Omega$

### 特殊符号

$\infty$, $\pi$, $e$, $\sqrt{2}$, $\emptyset$

$\cup$, $\cap$, $\subset$, $\supset$, $\in$, $\notin$

$\forall$, $\exists$, $\neg$, $\Rightarrow$, $\Leftrightarrow$

### 大型运算符

$\sum$, $\prod$, $\int$, $\oint$, $\bigcup$, $\bigcap$

### 括号

小括号：$(x + y)$

中括号：$[a, b]$

大括号：$\{x \mid x > 0\}$

绝对值：$|x|$

范数：$\|x\|$

### 分段函数

$$
f(x) = 
\begin{cases} 
x^2 & \text{if } x \geq 0, \\
-x^2 & \text{if } x < 0.
\end{cases}
$$

### 对齐公式

$$
\begin{align*}
(a + b)^2 &= a^2 + 2ab + b^2 \\
(a - b)^2 &= a^2 - 2ab + b^2 \\
(a + b)(a - b) &= a^2 - b^2
\end{align*}
$$

### 导数与微分

$\frac{d}{dx} f(x) = f'(x)$

$\frac{d^2}{dx^2} f(x) = f''(x)$

$\frac{\partial f}{\partial x}$

$df = \frac{\partial f}{\partial x}dx + \frac{\partial f}{\partial y}dy$

### 级数

泰勒展开：$e^x = \sum_{n=0}^{\infty} \frac{x^n}{n!}$

傅里叶级数：$f(x) = \frac{a_0}{2} + \sum_{n=1}^{\infty} (a_n\cos nx + b_n\sin nx)$

### 概率统计

期望：$E[X] = \mu$

方差：$Var(X) = \sigma^2$

正态分布：$X \sim N(\mu, \sigma^2)$

概率密度：$f(x) = \frac{1}{\sqrt{2\pi}\sigma} e^{-\frac{(x-\mu)^2}{2\sigma^2}}$

### 组合数学

组合数：$\binom{n}{k} = \frac{n!}{k!(n-k)!}$

排列数：$P(n, k) = \frac{n!}{(n-k)!}$

二项式定理：$(a + b)^n = \sum_{k=0}^{n} \binom{n}{k} a^{n-k} b^k$

---

## 9. 特殊字符

| 字符 | 代码 | 显示 |
|------|------|------|
| 反斜杠 | `\\` | \ |
| 星号 | `\*` | * |
| 下划线 | `\_` | _ |
| 井号 | `\#` | # |
| 加号 | `\+` | + |
| 减号 | `\-` | - |
| 点号 | `\.` | . |
| 括号 | `\(` `\)` | ( ) |
| 方括号 | `\[` `\]` | [ ] |
| 花括号 | `\{` `\}` | { } |

---

## 10. 结语

这篇测试文章包含了 Markdown 的所有主要语法和 LaTeX 的常用数学公式，用于验证渲染效果的完整性和正确性。
