# Crear una extensión de Burp Suite desde cero

Esta guía muestra cómo crear una primera extensión Java, compilarla y cargarla en Burp Suite. Después explica cómo esa misma estructura se utiliza en **Kenma Scout**, la extensión de esta carpeta.

## 1. Entender las herramientas

- **Java:** lenguaje en el que escribimos la extensión.
- **Montoya API:** biblioteca de Burp que permite trabajar con peticiones, respuestas, Repeater, menús y pestañas.
- **Visual Studio Code:** editor donde podemos escribir Java. También puedes usar IntelliJ IDEA o Eclipse.
- **JDK:** incluye `javac` para compilar y `jar` para empaquetar.
- **Burp Suite:** carga y ejecuta el archivo `.jar` resultante.

La extensión se ejecuta dentro de Burp. No necesita un servidor web ni desplegarse en AWS. El backend del laboratorio, ubicado en `../backend/`, es un componente separado.

## 2. Preparar el entorno

Para seguir los comandos de este repositorio necesitas:

- JDK 21 o superior, con `java`, `javac` y `jar` en el `PATH`.
- Node.js 22 o superior para los scripts del proyecto.
- Burp Suite compatible con la versión de Montoya que utiliza este proyecto: `2026.7`.
- Opcionalmente, VS Code con **Extension Pack for Java**.

Comprueba las herramientas en una terminal PowerShell:

```powershell
java -version
javac -version
jar --version
node --version
```

Abre la carpeta raíz del repositorio en VS Code. Los comandos siguientes parten de esa carpeta, la que contiene `package.json`.

## 3. Obtener Montoya API

Este proyecto ya incluye un script para descargar la dependencia y comprobar su SHA-256:

```powershell
npm run build:extension
```

En la primera ejecución necesita acceso a Maven Central. Guarda la biblioteca en:

```text
extension/lib/montoya-api-2026.7.jar
```

Este comando también compila Kenma Scout. Para aprender desde cero, en los siguientes pasos crearemos una extensión mínima en otra carpeta, sin modificar su código.

Montoya se utiliza al compilar, pero no se incluye en nuestro JAR: Burp proporciona la biblioteca cuando carga la extensión.

## 4. Crear la primera clase

Crea esta estructura dentro de `extension/`:

```text
primeros-pasos/
  src/
    demo/
      MiExtension.java
```

El contenido de `MiExtension.java` debe ser:

```java
package demo;

import burp.api.montoya.BurpExtension;
import burp.api.montoya.MontoyaApi;

public final class MiExtension implements BurpExtension {
    @Override
    public void initialize(MontoyaApi api) {
        api.extension().setName("Mi primera extensión");
        api.logging().logToOutput("¡Hola! La extensión se cargó correctamente.");
    }
}
```

Qué ocurre aquí:

- `implements BurpExtension` identifica la clase como una extensión de Burp.
- Burp llama a `initialize` al cargarla.
- El parámetro `api` permite acceder a las funciones de Burp.
- `setName` establece el nombre y `logToOutput` escribe en la salida de la extensión.

## 5. Compilar y generar el JAR

Desde la raíz del repositorio, ejecuta en PowerShell:

```powershell
New-Item -ItemType Directory -Force extension/primeros-pasos/build/classes

javac --release 21 -encoding UTF-8 `
  -cp extension/lib/montoya-api-2026.7.jar `
  -d extension/primeros-pasos/build/classes `
  extension/primeros-pasos/src/demo/MiExtension.java

jar --create `
  --file extension/primeros-pasos/build/mi-extension.jar `
  -C extension/primeros-pasos/build/classes .
```

Ejecuta el comando `jar` únicamente si `javac` termina sin errores. Los acentos graves al final de las líneas indican continuación en PowerShell; no añadas espacios después de ellos.

`javac` convierte el código Java en clases compiladas. `jar` empaqueta esas clases en un archivo que Burp puede cargar. No necesitas definir una función `main`: Burp es quien inicia la extensión.

## 6. Cargarla en Burp Suite

1. Abre **Extensions → Installed → Add**.
2. Selecciona el tipo **Java**.
3. Elige `extension/primeros-pasos/build/mi-extension.jar`.
4. Confirma la carga.
5. Selecciona la extensión y revisa su pestaña **Output**.

Debe aparecer el nombre **Mi primera extensión** y el mensaje de bienvenida. Con esto ya has creado una extensión funcional desde cero.

## 7. Agregar una pestaña propia

Ahora reemplaza el contenido de `MiExtension.java` por esta versión:

```java
package demo;

import burp.api.montoya.BurpExtension;
import burp.api.montoya.MontoyaApi;
import javax.swing.JButton;
import javax.swing.JLabel;
import javax.swing.JPanel;
import javax.swing.SwingUtilities;

public final class MiExtension implements BurpExtension {
    @Override
    public void initialize(MontoyaApi api) {
        api.extension().setName("Mi primera extensión");

        SwingUtilities.invokeLater(() -> {
            JPanel panel = new JPanel();
            JLabel mensaje = new JLabel("Mi extensión está funcionando");
            JButton boton = new JButton("Saludar");

            boton.addActionListener(event ->
                api.logging().logToOutput("¡Hola desde el botón!")
            );

            panel.add(mensaje);
            panel.add(boton);
            api.userInterface().registerSuiteTab("Mi extensión", panel);
        });
    }
}
```

Repite la compilación del paso 5. Descarga la extensión anterior desde Burp antes de volver a añadir el JAR actualizado. Si Burp mantiene bloqueado el archivo en Windows, descárgala antes de compilar.

Ahora verás una pestaña **Mi extensión**. Al pulsar **Saludar**, aparecerá un mensaje en **Output**.

Swing proporciona los componentes visuales. `SwingUtilities.invokeLater` programa su creación en el hilo de interfaz. Las tareas de red deben ejecutarse fuera de ese hilo para evitar bloquear la pantalla.

## 8. Pasar del ejemplo a Kenma Scout

El código real está en [KenmaScout.java](src/main/java/pe/nekoma/KenmaScout.java). Parte del mismo método `initialize` y agrega estas funciones:

| Función | Cómo se implementa en el proyecto |
| --- | --- |
| Mostrar una pestaña | Swing y `api.userInterface().registerSuiteTab(...)` |
| Agregar un menú contextual | `ContextMenuItemsProvider` y su registro en la interfaz |
| Tomar una petición seleccionada | `ContextMenuEvent` |
| Comprobar el alcance | `api.scope().isInScope(...)` |
| Comparar acceso a reportes | Cuatro GET secuenciales con la misma identidad |
| Preparar peticiones para revisión | `api.repeater().sendToRepeater(...)` |
| Mostrar resultados | Una tabla Swing con estado HTTP y tamaño |
| Ejecutar la comparación sin bloquear la interfaz | Un `ExecutorService` |

Para demostrar la extensión completa:

```powershell
npm run build:extension
npm run test:extension
```

Carga `extension/build/kenma-scout.jar` en Burp. Añade el dominio del laboratorio al Target Scope y selecciona una petición autenticada `GET /api/reports/NEK-001` para abrir el menú **Kenma Scout**.

La comparación envía cuatro GET. Las opciones PATCH y DELETE preparan peticiones en Repeater para su envío manual. Los resultados ayudan a comparar respuestas; para interpretar un posible acceso indebido también hay que comprobar el equipo y el rol del usuario.

Las pruebas del repositorio verifican la lógica mediante dobles de Montoya; la carga del JAR y la interacción visual se comprueban dentro de Burp.

## Problemas frecuentes

- **`javac` no se reconoce:** instala un JDK y añade su carpeta `bin` al `PATH`; vuelve a abrir la terminal.
- **`package burp.api.montoya does not exist`:** comprueba que el JAR de Montoya existe y que ejecutas los comandos desde la raíz del repositorio.
- **Error de versión de clases al cargar:** comprueba que el Java utilizado por Burp admite las clases compiladas para Java 21.
- **La extensión carga pero no muestra una pestaña:** el ejemplo inicial solo escribe en Output; la pestaña se agrega en el paso 7.
- **No aparece el menú de Kenma Scout:** comprueba que seleccionaste un GET de reporte de Nekoma, con cabecera `Authorization` y una URL incluida en el scope.
