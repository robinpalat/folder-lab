```markdown
# 📂 Folder Lab para Obsidian

> **Ordena tus notas como capítulos de un libro. Sin romper nada.**

Organiza manualmente las notas de una carpeta con **arrastre**, como si estuvieras estructurando los capítulos de un libro. El orden se guarda en un archivo oculto, sin modificar nombres, frontmatter ni metadatos.

---

## ✨ Características

| Funcionalidad | Descripción |
|---------------|-------------|
| 📁 **Orden manual** | Arrastra y suelta las notas para reordenarlas como quieras |
| 💾 **Guardado oculto** | El orden se guarda en `.folder-lab/` dentro de cada carpeta |
| 🔄 **No destructivo** | No modifica nombres, frontmatter ni metadatos |
| 📋 **Nota General** | Bloc de notas por carpeta (archivo `_nota_general.txt`) |
| 📝 **Notas particulares** | Cada nota tiene su propio bloc de notas asociado |
| 📊 **Estadísticas** | Barra de progreso con porcentaje de notas completadas |
| 📄 **Notas vacías** | Detección automática de notas vacías (se muestran en gris) |
| 📚 **Exportación** | Exporta el índice o todas las notas en orden (MD, TXT) |
| 📖 **Conteo de palabras** | Cuenta las palabras de todo el libro (carpeta raíz + subcarpetas) |
| 🎨 **Diseño elegante** | Estilo tipo libro/índice, compatible con tema oscuro |
| 🌙 **Modo oscuro** | Soporte completo para tema oscuro de Obsidian |

---

## 📥 Instalación

### Desde la comunidad de Obsidian

1. Ve a **Configuración** → **Plugins de la comunidad**
2. Busca **"Folder Lab"**
3. Haz clic en **Instalar** y luego en **Activar**

### Instalación manual

```bash
# Clona el repositorio
git clone https://github.com/robinpalat/folder-lab.git

# Copia la carpeta a tu vault
cp -r folder-lab /ruta/a/tu-vault/.obsidian/plugins/

# Reinicia Obsidian
```

---

## 🚀 Cómo usar

### 1. Abrir el panel

Haz clic en el icono 📂 en el ribbon lateral o usa el comando:

```
Abrir panel de orden de carpeta
```

### 2. Seleccionar una carpeta

- Haz clic derecho sobre una carpeta → **"Abrir en Folder Lab"**
- O navega desde el panel

### 3. Reordenar notas

Arrastra el handle `⋮` para reordenar las notas. El orden se guarda automáticamente.

### 4. Nota General

El panel inferior muestra la **Nota General** de la carpeta. Úsala para el contexto general del capítulo.

### 5. Notas particulares

Haz clic en cualquier nota del índice para ver su nota particular en el panel inferior.

### 6. Nota compilada

La nota con el mismo nombre que la carpeta aparece al principio del índice con el icono 🔄. Haz clic en el icono para actualizar su contenido con todas las notas en orden.

### 7. Exportar

Desde el menú **Exportar** puedes:
- 📋 Copiar lista (TXT)
- 📄 Guardar como TXT
- 📝 Guardar como Markdown (índice)
- 📚 Exportar todas las notas (MD)

### 8. Contar palabras

Haz clic en el botón 📊 para contar las palabras de todo el libro (carpeta raíz + subcarpetas).

---

## 📋 Estructura de archivos

```
tu-carpeta/
├── .folder-lab/              ← Carpeta oculta del plugin
│   ├── _folder_order.json      ← Orden y notas particulares
│   └── _nota_general.txt       ← Nota General
├── NombreCarpeta.md            ← Nota compilada (exportada)
├── nota1.md
├── nota2.md
└── ...
```

### `_folder_order.json`

```json
{
  "order": [
    "nota1.md",
    "nota2.md",
    "nota3.md"
  ],
  "notes": {
    "nota1.md": "Nota particular de nota1",
    "nota2.md": "Nota particular de nota2"
  },
  "version": "1.0.0",
  "lastModified": "2026-07-25T..."
}
```

---

## ⚙️ Configuración

| Opción | Descripción |
|--------|-------------|
| **Usar orden manual** | Activa/desactiva el orden manual en el explorador |
| **Mostrar números** | Muestra numeración en el índice (romana/arábiga) |
| **Estilo de numeración** | Romana (I, II, III), Arábiga (1, 2, 3) o Sin números |
| **Carpeta raíz del libro** | Carpeta principal para el conteo de palabras |

---

## 🎨 Visual

### Índice

```
📂 Mi Carpeta
├── 📋 Mi Carpeta                     [🔄]  ← Nota compilada
├── I. Introducción                    [⋮]
├── II. Desarrollo                     [⋮]
├── III. 📄 Análisis (pendiente)       [⋮]  ← Nota vacía
└── IV. Conclusiones                   [⋮]
```

### Estadísticas

```
8 notas  ·  62% completado
```

---

## 🛠️ Comandos

| Comando | Descripción |
|---------|-------------|
| `Abrir panel de orden de carpeta` | Abre el panel lateral |
| `Ordenar carpeta actual` | Abre el panel con la carpeta activa |

---

## 📖 Flujo de trabajo recomendado

1. 📂 **Crea una carpeta** para tu capítulo
2. ✍️ **Escribe tus notas** (pueden estar vacías)
3. 📋 **Ordena** las notas en el índice
4. 📝 **Escribe la Nota General** con el contexto del capítulo
5. 📄 **Escribe notas particulares** para cada sección
6. 📚 **Exporta** todas las notas en orden
7. 🔄 **Actualiza** la nota compilada con el icono de refrescar

---

## 🤝 Contribuciones

Las contribuciones son bienvenidas. Si encuentras un bug o tienes una sugerencia, abre un issue o un pull request.

---

## 📄 Licencia

MIT © robinpalat

---

## 📞 Contacto

- **GitHub**: robinpalat (https://github.com/robinpalat)
- **Reportar bugs**: [Issues](https://github.com/robinpalat/folder-lab/issues)

---

## 🆘 Solución de problemas

### ❌ El orden no se guarda
- Verifica que la carpeta tenga permisos de escritura
- Asegúrate de que el archivo `_folder_order.json` se haya creado

### ❌ La nota compilada no aparece
- Exporta todas las notas desde el menú **Exportar**
- O crea manualmente una nota con el nombre de la carpeta

### ❌ El panel no se abre
- Verifica que el plugin esté activado
- Reinicia Obsidian

---

## 💡 Inspiración

Folder Lab nació de la necesidad de organizar capítulos de un libro sin renombrar archivos ni romper enlaces. Es la herramienta perfecta para escritores, investigadores y cualquier persona que trabaje con grandes conjuntos de notas.

---

**¡Feliz escritura!** ✍️📚
```
