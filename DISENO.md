# Sistema de diseño — Agente de WhatsApp

> **«Vidrio frío y cian»** · oscuro por defecto · denso en datos, pero respirado.
>
> La **fuente de verdad de los valores** es
> [`src/app/globals.css`](src/app/globals.css). Este documento explica **por qué**
> son esos y **cómo se combinan**; si algún día discrepan, manda el CSS y hay
> que corregir aquí.
>
> El catálogo vivo está en [`/ui`](src/app/ui/page.tsx), solo en desarrollo.

---

## 0. El norte

Esto es una **interfaz de operador**: alguien la mira durante toda su jornada
para atender conversaciones reales. De ahí salen las tres decisiones que lo
gobiernan todo:

1. **Oscuro por defecto.** Ocho horas de fondo blanco cansan.
2. **El dato manda sobre el adorno.** Un teléfono, una hora, un coste y un
   estado tienen que leerse de un vistazo. Nada puede competir con ellos.
3. **El color se gasta con cuentagotas.** El cian es acento, no decoración. Si
   se usa en todo, deja de significar «mira aquí».

### ⛔ Prohibido

Reglas duras. Si un diseño cae en una, está mal:

| Prohibido | Por qué, y qué hacer |
| --- | --- |
| **Verde como color de marca** | El verde es de WhatsApp. En un inbox de WhatsApp, usarlo para otra cosa confunde qué es la plataforma y qué es el mensaje. Solo `--color-whatsapp`, y solo para lo que es de WhatsApp. |
| **Ámbar o rojo decorativos** | Están reservados a estados: ventana por caducar, gasto al límite, fallo. Si se usan por gusto, dejan de avisar. |
| **Degradados** | Salvo el halo cian del fondo, que está en `body::before` y es el único. Un degradado morado es el uniforme de cualquier producto de IA de 2026. |
| **Radios ≥ 20px en contenedores** | Máximo **16px** (`--radius-card`). Solo pills, avatares y badges van completamente redondeados. |
| **Hex sueltos en las clases** | `bg-[#22d3ee]` rompe el tema claro y el día que cambie el acento hay que buscarlo por todo el código. Siempre tokens. |
| **Texto blanco sobre el cian** | El cian es claro. Encima va `--color-primary-foreground`, que es tinta oscura. |
| **Sombras difusas grises** | La profundidad la dan el borde y el fondo de la tarjeta, no una sombra. |
| **Iconos como única señal** | Un punto de color o un icono sin texto no se entiende ni es accesible. Siempre acompañado de palabra. |

---

## 1. Color

Los tokens van en **OKLch**, que mantiene el brillo percibido constante al
cambiar de tono. Si mañana el acento pasa de cian a otro color, los contrastes
siguen cuadrando sin recalibrarlos a ojo.

### 1.1 Marca

| Token | Uso |
| --- | --- |
| `--color-primary` · cian `oklch(0.79 0.13 205)` | El botón de la acción principal, el foco, **un** acento por pantalla |
| `--color-primary-foreground` · tinta oscura | Lo único que va encima del cian |

**Por qué cian y no lima:** el lima competía con el verde de WhatsApp, que en
esta aplicación es inevitable.

### 1.2 Neutrales

`--color-background` (el lienzo) · `--color-card` (superficies) ·
`--color-muted` (fondos de apoyo) · `--color-border` · `--color-input`.

Texto: `--color-foreground` y `--color-muted-foreground`. **Dos niveles, no
tres:** un tercer gris intermedio siempre acaba usándose mal.

### 1.3 Semánticos — reservados

| Token | Qué significa, y solo eso |
| --- | --- |
| `success` | Salió bien: mensaje enviado, claves guardadas |
| `warning` | Pide atención pero no está roto: traspaso pendiente, ventana por caducar, gasto cerca del tope |
| `destructive` | Está roto o es irreversible: fallo de envío, canal sin conectar, parar el agente |
| `info` | Contexto neutro |
| `whatsapp` | Solo lo que es literalmente de WhatsApp |

---

## 2. Tipografía — IBM Plex

Elegida por ser una familia pensada para interfaces técnicas, con una mono que
acompaña a la sans sin parecer de otro sitio.

| Rol | Familia | Cuándo |
| --- | --- | --- |
| Interfaz | `--font-sans` (Plex Sans) | Todo por defecto |
| **Datos** | `--font-mono` vía la clase `.dato` | Teléfonos, wamid, identificadores, horas, importes, contadores |

**`.dato` no es decorativa.** Lleva `tabular-nums`, que da a las cifras el mismo
ancho: por eso una columna de costes queda alineada y un `+34600111222` no se
confunde con un nombre.

### Escala

| Uso | Clases |
| --- | --- |
| Título de pantalla | `text-2xl font-semibold tracking-tight` |
| Número protagonista (una métrica) | `text-3xl font-semibold text-primary` |
| Encabezado de sección | `text-sm font-semibold tracking-[0.14em] uppercase text-muted-foreground` |
| Cuerpo | `text-sm` |
| Apoyo, pies, metadatos | `text-xs text-muted-foreground` |
| Etiquetas dentro de una burbuja | `text-[11px]` |

El encabezado de sección en versalitas con `tracking` amplio es la firma de esta
interfaz: separa bloques sin necesidad de líneas ni cajas.

---

## 3. Espaciado y forma

Escala de Tailwind, pero **no todos los pasos**. Los que se usan:

- Dentro de un componente: `gap-1.5`, `gap-2`, `gap-3`
- Padding de tarjeta: `p-6` (`p-4` en tarjetas pequeñas de dato)
- Entre secciones de una pantalla: `space-y-6`
- Ancho de columna de lectura: `max-w-2xl`; listados `max-w-3xl`; pantallas de
  dos columnas `max-w-6xl`

| Radio | Token | Para |
| --- | --- | --- |
| 16px | `--radius-card` | Tarjetas, secciones, burbujas |
| 10px | `--radius-control` | Botones, campos, avisos |
| completo | `rounded-full` | Pills, badges, avatares |

---

## 4. Patrones

Lo que ya existe en la aplicación. **Antes de inventar uno nuevo, usar estos.**

### 4.1 Tarjeta de sección

```html
<section class="rounded-[var(--radius-card)] border border-border bg-card/60 p-6">
  <h2 class="text-sm font-semibold tracking-[0.14em] text-muted-foreground uppercase">Título</h2>
  …
</section>
```

El `bg-card/60` en vez de opaco es lo que deja pasar el halo del fondo. Es todo
el «vidrio» que hay: sin `backdrop-blur`, que en listas largas cuesta caro.

### 4.2 Pill de estado

```html
<span class="dato rounded-full bg-warning/15 px-2.5 py-1 text-xs text-warning">Handoff</span>
```

Fondo al 15 % del color y texto al color pleno. Vale para `primary`, `warning`,
`destructive`, `success`.

### 4.3 Métrica

Número grande en `text-3xl`, etiqueta encima en `text-sm text-muted-foreground`,
y debajo **una frase que explique qué significa**. Un número sin frase obliga a
adivinar.

### 4.4 Fila de lista con estado

Nombre + contador sin leer a la derecha · adelanto del último mensaje truncado ·
tira de pills debajo. Lo que pide atención lleva `border-l-2 border-l-warning
bg-warning/5`: se distingue de un vistazo sin repintar la fila entera, que
cansaría con veinte esperando.

### 4.5 Aviso

`role="alert"` para el error, `role="status"` para el éxito — un lector de
pantalla debe anunciarlos al aparecer. Borde al 40 % y fondo al 10 % del color.

### 4.6 Vacío

Nunca una pantalla en blanco. Un borde discontinuo, una frase que diga qué pasa
y **otra que diga qué hacer ahora**.

---

## 5. Accesibilidad — no es un repaso final

- `:focus-visible` con anillo cian de 2px ya está en `globals.css`. **No
  quitarlo:** esta interfaz se recorre mucho con teclado.
- Todo control tiene etiqueta. Los `<select>` sueltos llevan `aria-label`.
- El color nunca es la única señal: junto al punto ámbar va la palabra.
- Los adjuntos llevan texto alternativo escrito, no el nombre del archivo.

---

## 6. Movimiento

Poco y corto. `transition` sin duración explícita (150 ms de Tailwind) para
hover y foco. **Nada que se mueva solo**: en una pantalla que se actualiza en
tiempo real, una animación se confunde con un mensaje nuevo.

---

## 7. Qué NO se copió del fork del curso

Su sistema es *«Glass + Electric Lime»*: lima eléctrica, glassmorphism con
`backdrop-blur`, Space Grotesk y layout bento. Es coherente y está bien hecho.

Aquí se tomó **la idea de tener un sistema escrito con anti-patrones**, y se
descartó su estética entera: el lima por el conflicto con WhatsApp, el blur por
coste en listas largas, y el bento porque esta aplicación es de lectura en
columna, no un escaparate de métricas.
