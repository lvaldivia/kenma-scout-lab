package pe.nekoma;

import burp.api.montoya.BurpExtension;
import burp.api.montoya.MontoyaApi;
import burp.api.montoya.http.message.HttpRequestResponse;
import burp.api.montoya.http.message.requests.HttpRequest;
import burp.api.montoya.ui.contextmenu.ContextMenuEvent;
import burp.api.montoya.ui.contextmenu.ContextMenuItemsProvider;
import java.awt.BorderLayout;
import java.awt.Component;
import java.awt.event.MouseAdapter;
import java.awt.event.MouseEvent;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.regex.Pattern;
import javax.swing.*;
import javax.swing.table.DefaultTableModel;

/**
 * Extensión didáctica del laboratorio: compara acceso a reportes y prepara ejemplos en Repeater.
 * BurpExtension define el punto de entrada; ContextMenuItemsProvider aporta el menú contextual.
 * Utiliza Montoya API sin Scanner, Intruder, persistencia en disco ni funciones Pro.
 */
public final class KenmaScout implements BurpExtension, ContextMenuItemsProvider {
    // Burp entrega este objeto al cargar la extensión; permite acceder a HTTP, interfaz y Repeater.
    private MontoyaApi api;
    // Las peticiones se ejecutan secuencialmente fuera del hilo de interfaz para no bloquear Burp.
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    // Evita iniciar otra comparación mientras la anterior sigue en curso.
    private final AtomicBoolean running = new AtomicBoolean();
    // Solo se accede a esta lista desde el hilo de eventos de Swing (EDT).
    // Cada posición corresponde a una fila del modelo de la tabla.
    private final List<HttpRequestResponse> results = new ArrayList<>();
    private final DefaultTableModel model = new DefaultTableModel(
            new String[]{"Objeto", "HTTP", "Bytes", "Lectura"}, 0) {
        @Override public boolean isCellEditable(int row, int column) { return false; }
    };
    private final JLabel status = new JLabel("Selecciona un GET /api/reports/NEK-001 dentro del scope.");

    // Burp llama a initialize al cargar el JAR; la extensión no necesita un método main.
    @Override public void initialize(MontoyaApi api) {
        this.api = api;
        api.extension().setName("Kenma Scout — Nekoma vs Karasuno");
        // Al descargar la extensión, solicita detener las tareas pendientes o en ejecución.
        api.extension().registerUnloadingHandler(() -> worker.shutdownNow());
        api.userInterface().registerContextMenuItemsProvider(this);
        // La creación y actualización de componentes Swing se programa en su hilo de eventos.
        SwingUtilities.invokeLater(() -> {
            JTable table = new JTable(model);
            table.addMouseListener(new MouseAdapter() {
                @Override public void mouseClicked(MouseEvent event) {
                    if (event.getClickCount() == 2 && table.getSelectedRow() >= 0) {
                        // Convierte la fila visual a su índice en el modelo antes de recuperar la petición.
                        var result = results.get(table.convertRowIndexToModel(table.getSelectedRow()));
                        api.repeater().sendToRepeater(result.request(), "Kenma — evidencia");
                    }
                }
            });
            JButton clear = new JButton("Limpiar resultados");
            // No se borra la tabla mientras el trabajador está incorporando resultados.
            clear.addActionListener(event -> { if (!running.get()) { results.clear(); model.setRowCount(0); } });
            JPanel panel = new JPanel(new BorderLayout(8, 8));
            panel.add(status, BorderLayout.NORTH);
            panel.add(new JScrollPane(table), BorderLayout.CENTER);
            panel.add(clear, BorderLayout.SOUTH);
            api.userInterface().registerSuiteTab("Kenma Scout", panel);
        });
        api.logging().logToOutput("Listo. Menú contextual sobre un GET de reporte en scope. Solo 4 GET por comparación.");
    }

    @Override public List<Component> provideMenuItems(ContextMenuEvent event) {
        // Prioriza la petición abierta en el editor; si no existe, toma la primera seleccionada.
        HttpRequest request = event.messageEditorRequestResponse()
                .map(editor -> editor.requestResponse().request())
                .orElseGet(() -> event.selectedRequestResponses().isEmpty() ? null
                        : event.selectedRequestResponses().get(0).request());
        // El menú solo aparece para reportes de Nekoma autenticados y dentro del Target Scope.
        // El prefijo /demo también admite la ruta directa de API Gateway del laboratorio.
        if (request == null || !request.method().equals("GET")
                || !request.pathWithoutQuery().matches("(?:/demo)?/api/reports/NEK-\\d{3}")
                || !api.scope().isInScope(request.url()) || !request.hasHeader("Authorization")) return List.of();

        JMenu menu = new JMenu("Kenma Scout");
        JMenuItem bola = new JMenuItem("Comparar BOLA — 4 GET (propio + KAR-001..003)");
        bola.addActionListener(event1 -> compare(request));
        menu.add(bola);
        // withPath/withMethod/withBody crean una petición modificada a partir de la original.
        // Se conserva Authorization para probar con la misma identidad.
        // Este PATCH se prepara en Repeater: el usuario decide cuándo enviarlo.
        JMenuItem mass = new JMenuItem("Preparar PATCH role=coach en Repeater");
        mass.addActionListener(event1 -> api.repeater().sendToRepeater(
                request.withPath(basePath(request) + "/me").withMethod("PATCH")
                        .withHeader("Content-Type", "application/json").withBody("{\"role\":\"coach\"}"),
                "Kenma — mass assignment"));
        menu.add(mass);
        // El DELETE también requiere envío manual; permite estudiar la caché del authorizer.
        JMenuItem cache = new JMenuItem("Preparar DELETE NEK-002 en Repeater");
        cache.addActionListener(event1 -> api.repeater().sendToRepeater(
                request.withPath(basePath(request) + "/reports/NEK-002").withMethod("DELETE").withBody(""),
                "Kenma — caché authorizer"));
        menu.add(cache);
        return List.of(menu);
    }

    private static String basePath(HttpRequest request) {
        // Conserva /api o /demo/api para reutilizar la misma lógica en ambos accesos al laboratorio.
        return request.pathWithoutQuery().substring(0, request.pathWithoutQuery().lastIndexOf("/reports/"));
    }

    private void compare(HttpRequest original) {
        // La transición atómica de false a true funciona como bloqueo de una sola comparación.
        if (!running.compareAndSet(false, true)) return;
        results.clear(); model.setRowCount(0);
        status.setText("Comparando con la misma identidad. Estos GET calientan la caché del authorizer.");
        worker.submit(() -> {
            try {
                // Primero consulta el reporte original como referencia; después, tres de Karasuno.
                // Estos GET pueden poblar la caché del authorizer del laboratorio.
                String[] ids = {original.pathWithoutQuery().substring(original.pathWithoutQuery().lastIndexOf('/') + 1),
                        "KAR-001", "KAR-002", "KAR-003"};
                for (String id : ids) {
                    if (Thread.currentThread().isInterrupted()) break;
                    HttpRequest request = original.withPath(basePath(original) + "/reports/" + id).withBody("");
                    // Revalida el alcance antes de cada envío por si cambió desde que se abrió el menú.
                    if (!api.scope().isInScope(request.url())) throw new IllegalStateException("Fuera del scope");
                    HttpRequestResponse result = api.http().sendRequest(request);
                    // La lectura orienta la revisión; un 200 con team=KAR no demuestra BOLA por sí solo.
                    // Hay que confirmar la identidad y el equipo mediante /me.
                    String reading = !result.hasResponse() ? "Sin respuesta"
                            : result.response().statusCode() == 200 && id.startsWith("KAR-")
                            && Pattern.compile("\"team\"\\s*:\\s*\"KAR\"").matcher(result.response().bodyToString()).find()
                            ? "Objeto de Karasuno visible: revisar identidad en /me"
                            : result.response().statusCode() == 403 ? "Acceso denegado" : "Control / revisar respuesta";
                    // El trabajador obtiene la respuesta; el EDT actualiza lista y tabla juntas.
                    SwingUtilities.invokeLater(() -> {
                        results.add(result);
                        model.addRow(new Object[]{id, result.hasResponse() ? result.response().statusCode() : "—",
                                result.hasResponse() ? result.response().body().length() : 0, reading});
                    });
                }
                SwingUtilities.invokeLater(() -> status.setText("Comparación terminada. Doble clic envía una petición a Repeater."));
            } catch (Exception error) {
                // Registra solo el tipo de error para no exponer peticiones, tokens ni cuerpos.
                api.logging().logToError("Comparación interrumpida: " + error.getClass().getSimpleName());
                SwingUtilities.invokeLater(() -> status.setText("No se completó. Revisa la conexión y el scope."));
            // Libera el bloqueo en el EDT, después de las actualizaciones ya encoladas.
            } finally { SwingUtilities.invokeLater(() -> running.set(false)); }
        });
    }
}
