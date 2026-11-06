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

/** Small, bounded lab assistant. No Scanner, Intruder, disk persistence or Pro API. */
public final class KenmaScout implements BurpExtension, ContextMenuItemsProvider {
    private MontoyaApi api;
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final AtomicBoolean running = new AtomicBoolean();
    private final List<HttpRequestResponse> results = new ArrayList<>(); // EDT only
    private final DefaultTableModel model = new DefaultTableModel(
            new String[]{"Objeto", "HTTP", "Bytes", "Lectura"}, 0) {
        @Override public boolean isCellEditable(int row, int column) { return false; }
    };
    private final JLabel status = new JLabel("Selecciona un GET /api/reports/NEK-001 dentro del scope.");

    @Override public void initialize(MontoyaApi api) {
        this.api = api;
        api.extension().setName("Kenma Scout — Nekoma vs Karasuno");
        api.extension().registerUnloadingHandler(() -> worker.shutdownNow());
        api.userInterface().registerContextMenuItemsProvider(this);
        SwingUtilities.invokeLater(() -> {
            JTable table = new JTable(model);
            table.addMouseListener(new MouseAdapter() {
                @Override public void mouseClicked(MouseEvent event) {
                    if (event.getClickCount() == 2 && table.getSelectedRow() >= 0) {
                        var result = results.get(table.convertRowIndexToModel(table.getSelectedRow()));
                        api.repeater().sendToRepeater(result.request(), "Kenma — evidencia");
                    }
                }
            });
            JButton clear = new JButton("Limpiar resultados");
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
        HttpRequest request = event.messageEditorRequestResponse()
                .map(editor -> editor.requestResponse().request())
                .orElseGet(() -> event.selectedRequestResponses().isEmpty() ? null
                        : event.selectedRequestResponses().get(0).request());
        if (request == null || !request.method().equals("GET")
                || !request.pathWithoutQuery().matches("(?:/demo)?/api/reports/NEK-\\d{3}")
                || !api.scope().isInScope(request.url()) || !request.hasHeader("Authorization")) return List.of();

        JMenu menu = new JMenu("Kenma Scout");
        JMenuItem bola = new JMenuItem("Comparar BOLA — 4 GET (propio + KAR-001..003)");
        bola.addActionListener(event1 -> compare(request));
        menu.add(bola);
        JMenuItem mass = new JMenuItem("Preparar PATCH role=coach en Repeater");
        mass.addActionListener(event1 -> api.repeater().sendToRepeater(
                request.withPath(basePath(request) + "/me").withMethod("PATCH")
                        .withHeader("Content-Type", "application/json").withBody("{\"role\":\"coach\"}"),
                "Kenma — mass assignment"));
        menu.add(mass);
        JMenuItem cache = new JMenuItem("Preparar DELETE NEK-002 en Repeater");
        cache.addActionListener(event1 -> api.repeater().sendToRepeater(
                request.withPath(basePath(request) + "/reports/NEK-002").withMethod("DELETE").withBody(""),
                "Kenma — caché authorizer"));
        menu.add(cache);
        return List.of(menu);
    }

    private static String basePath(HttpRequest request) {
        return request.pathWithoutQuery().substring(0, request.pathWithoutQuery().lastIndexOf("/reports/"));
    }

    private void compare(HttpRequest original) {
        if (!running.compareAndSet(false, true)) return;
        results.clear(); model.setRowCount(0);
        status.setText("Comparando con la misma identidad. Estos GET calientan la caché del authorizer.");
        worker.submit(() -> {
            try {
                String[] ids = {original.pathWithoutQuery().substring(original.pathWithoutQuery().lastIndexOf('/') + 1),
                        "KAR-001", "KAR-002", "KAR-003"};
                for (String id : ids) {
                    if (Thread.currentThread().isInterrupted()) break;
                    HttpRequest request = original.withPath(basePath(original) + "/reports/" + id).withBody("");
                    if (!api.scope().isInScope(request.url())) throw new IllegalStateException("Fuera del scope");
                    HttpRequestResponse result = api.http().sendRequest(request);
                    String reading = !result.hasResponse() ? "Sin respuesta"
                            : result.response().statusCode() == 200 && id.startsWith("KAR-")
                            && Pattern.compile("\"team\"\\s*:\\s*\"KAR\"").matcher(result.response().bodyToString()).find()
                            ? "Objeto de Karasuno visible: revisar identidad en /me"
                            : result.response().statusCode() == 403 ? "Acceso denegado" : "Control / revisar respuesta";
                    SwingUtilities.invokeLater(() -> {
                        results.add(result);
                        model.addRow(new Object[]{id, result.hasResponse() ? result.response().statusCode() : "—",
                                result.hasResponse() ? result.response().body().length() : 0, reading});
                    });
                }
                SwingUtilities.invokeLater(() -> status.setText("Comparación terminada. Doble clic envía una petición a Repeater."));
            } catch (Exception error) {
                // Never log full requests, bearer tokens or response bodies.
                api.logging().logToError("Comparación interrumpida: " + error.getClass().getSimpleName());
                SwingUtilities.invokeLater(() -> status.setText("No se completó. Revisa la conexión y el scope."));
            } finally { SwingUtilities.invokeLater(() -> running.set(false)); }
        });
    }
}
