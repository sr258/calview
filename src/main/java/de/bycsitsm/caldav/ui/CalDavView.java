package de.bycsitsm.caldav.ui;

import com.vaadin.flow.component.button.Button;
import com.vaadin.flow.component.button.ButtonVariant;
import com.vaadin.flow.component.dialog.Dialog;
import com.vaadin.flow.component.grid.Grid;
import com.vaadin.flow.component.grid.GridVariant;
import com.vaadin.flow.component.html.Span;
import com.vaadin.flow.component.icon.Icon;
import com.vaadin.flow.component.notification.Notification;
import com.vaadin.flow.component.notification.NotificationVariant;
import com.vaadin.flow.component.orderedlayout.VerticalLayout;
import com.vaadin.flow.component.textfield.PasswordField;
import com.vaadin.flow.component.textfield.TextField;
import com.vaadin.flow.router.Menu;
import com.vaadin.flow.router.PageTitle;
import com.vaadin.flow.router.Route;
import de.bycsitsm.base.ui.ViewToolbar;
import de.bycsitsm.caldav.CalDavEvent;
import de.bycsitsm.caldav.CalDavException;
import de.bycsitsm.caldav.CalDavService;
import de.bycsitsm.caldav.CalDavUser;

import java.time.format.DateTimeFormatter;
import java.util.List;

@Route("")
@PageTitle("CalDAV Users")
@Menu(order = 0, icon = "vaadin:calendar", title = "Users")
class CalDavView extends VerticalLayout {

    private final CalDavService calDavService;

    private final TextField urlField;
    private final TextField usernameField;
    private final PasswordField passwordField;
    private final Button connectButton;
    private final Grid<CalDavUser> userGrid;

    CalDavView(CalDavService calDavService) {
        this.calDavService = calDavService;

        setSizeFull();
        setPadding(false);
        setSpacing(false);

        // Connection form fields
        urlField = new TextField("CalDAV URL");
        urlField.setPlaceholder("https://calendar.example.com/caldav.php/");
        urlField.setWidthFull();
        urlField.setClearButtonVisible(true);

        usernameField = new TextField("Username");
        usernameField.setClearButtonVisible(true);

        passwordField = new PasswordField("Password");

        connectButton = new Button("Connect", event -> connect());
        connectButton.addThemeVariants(ButtonVariant.LUMO_PRIMARY);

        // Toolbar
        var toolbar = new ViewToolbar("Users",
                ViewToolbar.group(urlField, usernameField, passwordField, connectButton));
        add(toolbar);

        // User grid
        userGrid = createUserGrid();
        add(userGrid);

        // Click handler to show weekly appointments
        userGrid.addItemClickListener(event -> showWeekEvents(event.getItem()));
    }

    private Grid<CalDavUser> createUserGrid() {
        var grid = new Grid<CalDavUser>();
        grid.addThemeVariants(GridVariant.LUMO_ROW_STRIPES);
        grid.setSizeFull();

        grid.addColumn(CalDavUser::displayName)
                .setHeader("Name")
                .setAutoWidth(true)
                .setFlexGrow(1);

        grid.addColumn(CalDavUser::href)
                .setHeader("Path")
                .setAutoWidth(true)
                .setFlexGrow(1);

        return grid;
    }

    private static final DateTimeFormatter DATE_FORMATTER = DateTimeFormatter.ofPattern("EEE, MMM d");
    private static final DateTimeFormatter TIME_FORMATTER = DateTimeFormatter.ofPattern("HH:mm");

    private void showWeekEvents(CalDavUser user) {
        var url = urlField.getValue();
        var username = usernameField.getValue();
        var password = passwordField.getValue();

        if (url.isBlank() || username.isBlank() || password.isBlank()) {
            return;
        }

        try {
            var events = calDavService.fetchWeekEvents(url, user.href(), username, password);

            var dialog = new Dialog();
            dialog.setHeaderTitle("This Week \u2014 " + user.displayName());
            dialog.setWidth("700px");
            dialog.setMaxHeight("80vh");
            dialog.setDraggable(true);
            dialog.setResizable(true);

            // Close button in header
            var closeButton = new Button(new Icon("lumo", "cross"), e -> dialog.close());
            closeButton.addThemeVariants(ButtonVariant.LUMO_TERTIARY);
            dialog.getHeader().add(closeButton);

            if (events.isEmpty()) {
                var emptyMessage = new Span("No appointments this week.");
                emptyMessage.getStyle()
                        .set("color", "var(--lumo-secondary-text-color)")
                        .set("padding", "var(--lumo-space-m)");
                dialog.add(emptyMessage);
            } else {
                var eventGrid = createEventGrid(events);
                eventGrid.setItems(events);
                dialog.add(eventGrid);
            }

            // Footer with event count
            var countLabel = new Span(events.size() + " appointment(s)");
            countLabel.getStyle().set("color", "var(--lumo-secondary-text-color)");
            dialog.getFooter().add(countLabel);

            dialog.open();
        } catch (CalDavException e) {
            Notification.show("Could not load appointments: " + e.getMessage(), 5000,
                            Notification.Position.BOTTOM_CENTER)
                    .addThemeVariants(NotificationVariant.LUMO_ERROR);
        }
    }

    private Grid<CalDavEvent> createEventGrid(List<CalDavEvent> events) {
        var grid = new Grid<CalDavEvent>();
        grid.addThemeVariants(GridVariant.LUMO_ROW_STRIPES, GridVariant.LUMO_COMPACT);
        grid.setAllRowsVisible(true);

        grid.addColumn(event -> event.date().format(DATE_FORMATTER))
                .setHeader("Date")
                .setAutoWidth(true)
                .setFlexGrow(0);

        grid.addColumn(event -> formatTimeRange(event))
                .setHeader("Time")
                .setAutoWidth(true)
                .setFlexGrow(0);

        // Determine if any events have accessible details (calendar-query succeeded)
        var hasAccessibleEvents = events.stream().anyMatch(CalDavEvent::accessible);

        if (hasAccessibleEvents) {
            grid.addColumn(event -> event.summary() != null ? event.summary() : "(No title)")
                    .setHeader("Name")
                    .setAutoWidth(true)
                    .setFlexGrow(2);
        } else {
            grid.addComponentColumn(event -> {
                        var span = new Span("(Restricted)");
                        span.getStyle().set("color", "var(--lumo-secondary-text-color)")
                                .set("font-style", "italic");
                        return span;
                    })
                    .setHeader("Name")
                    .setAutoWidth(true)
                    .setFlexGrow(2);
        }

        grid.addComponentColumn(this::createStatusBadge)
                .setHeader("Status")
                .setAutoWidth(true)
                .setFlexGrow(0);

        return grid;
    }

    private String formatTimeRange(CalDavEvent event) {
        if (event.startTime() == null) {
            return "All day";
        }
        var start = event.startTime().format(TIME_FORMATTER);
        if (event.endTime() != null) {
            return start + " \u2013 " + event.endTime().format(TIME_FORMATTER);
        }
        return start;
    }

    private Span createStatusBadge(CalDavEvent event) {
        var label = switch (event.status().toUpperCase()) {
            case "PRIVATE" -> "Private";
            case "CONFIDENTIAL" -> "Confidential";
            case "BUSY" -> "Busy";
            case "BUSY-TENTATIVE" -> "Tentative";
            case "BUSY-UNAVAILABLE" -> "Unavailable";
            default -> "Public";
        };
        var variant = switch (event.status().toUpperCase()) {
            case "PRIVATE" -> "contrast";
            case "CONFIDENTIAL" -> "warning";
            case "BUSY" -> "contrast";
            case "BUSY-TENTATIVE" -> "warning";
            case "BUSY-UNAVAILABLE" -> "error";
            default -> "success";
        };
        var badge = new Span(label);
        badge.getElement().getThemeList().add("badge " + variant + " small");
        return badge;
    }

    private void connect() {
        var url = urlField.getValue();
        var username = usernameField.getValue();
        var password = passwordField.getValue();

        if (url.isBlank() || username.isBlank() || password.isBlank()) {
            Notification.show("Please fill in all fields.", 3000, Notification.Position.BOTTOM_CENTER)
                    .addThemeVariants(NotificationVariant.LUMO_WARNING);
            return;
        }

        connectButton.setEnabled(false);
        connectButton.setText("Connecting...");

        try {
            var users = calDavService.discoverUsers(url, username, password);
            userGrid.setItems(users);

            if (users.isEmpty()) {
                Notification.show("Connected successfully, but no users were found.", 5000,
                        Notification.Position.BOTTOM_CENTER);
            } else {
                Notification.show("Found " + users.size() + " user(s).", 3000,
                                Notification.Position.BOTTOM_CENTER)
                        .addThemeVariants(NotificationVariant.LUMO_SUCCESS);
            }
        } catch (CalDavException e) {
            userGrid.setItems(List.of());
            Notification.show(e.getMessage(), 5000, Notification.Position.BOTTOM_CENTER)
                    .addThemeVariants(NotificationVariant.LUMO_ERROR);
        } finally {
            connectButton.setEnabled(true);
            connectButton.setText("Connect");
        }
    }
}
