package de.bycsitsm.caldav.ui;

import com.vaadin.flow.component.button.Button;
import com.vaadin.flow.component.button.ButtonVariant;
import com.vaadin.flow.component.checkbox.Checkbox;
import com.vaadin.flow.component.dialog.Dialog;
import com.vaadin.flow.component.grid.Grid;
import com.vaadin.flow.component.grid.GridVariant;
import com.vaadin.flow.component.html.Div;
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
import de.bycsitsm.caldav.CalDavCalendar;
import de.bycsitsm.caldav.CalDavEvent;
import de.bycsitsm.caldav.CalDavException;
import de.bycsitsm.caldav.CalDavService;

import java.time.format.DateTimeFormatter;
import java.util.List;

@Route("")
@PageTitle("CalDAV Calendars")
@Menu(order = 0, icon = "vaadin:calendar", title = "Calendars")
class CalDavView extends VerticalLayout {

    private final CalDavService calDavService;

    private final TextField urlField;
    private final TextField usernameField;
    private final PasswordField passwordField;
    private final Checkbox includeAllCheckbox;
    private final Button connectButton;
    private final Grid<CalDavCalendar> calendarGrid;

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

        includeAllCheckbox = new Checkbox("Include all users");
        includeAllCheckbox.setHelperText("Show calendars from users without shared access");

        connectButton = new Button("Connect", event -> connect());
        connectButton.addThemeVariants(ButtonVariant.LUMO_PRIMARY);

        // Toolbar
        var toolbar = new ViewToolbar("Calendars",
                ViewToolbar.group(urlField, usernameField, passwordField, includeAllCheckbox, connectButton));
        add(toolbar);

        // Calendar grid
        calendarGrid = createCalendarGrid();
        add(calendarGrid);

        // Click handler to show weekly appointments
        calendarGrid.addItemClickListener(event -> showWeekEvents(event.getItem()));
    }

    private Grid<CalDavCalendar> createCalendarGrid() {
        var grid = new Grid<CalDavCalendar>();
        grid.addThemeVariants(GridVariant.LUMO_ROW_STRIPES);
        grid.setSizeFull();

        grid.addComponentColumn(this::createColorIndicator)
                .setHeader("Color")
                .setAutoWidth(true)
                .setFlexGrow(0);

        grid.addComponentColumn(this::createAccessBadge)
                .setHeader("Access")
                .setAutoWidth(true)
                .setFlexGrow(0);

        grid.addColumn(CalDavCalendar::displayName)
                .setHeader("Name")
                .setAutoWidth(true)
                .setFlexGrow(1);

        grid.addColumn(calendar -> calendar.owner() != null ? calendar.owner() : "")
                .setHeader("Owner")
                .setAutoWidth(true)
                .setFlexGrow(1);

        grid.addColumn(calendar -> calendar.description() != null ? calendar.description() : "")
                .setHeader("Description")
                .setAutoWidth(true)
                .setFlexGrow(2);

        grid.addColumn(CalDavCalendar::href)
                .setHeader("Path")
                .setAutoWidth(true)
                .setFlexGrow(1);

        return grid;
    }

    private Div createColorIndicator(CalDavCalendar calendar) {
        var indicator = new Div();
        indicator.setWidth("20px");
        indicator.setHeight("20px");
        indicator.getStyle()
                .set("border-radius", "4px")
                .set("background-color", calendar.color() != null ? calendar.color() : "#808080");
        if (!calendar.accessible()) {
            indicator.getStyle().set("opacity", "0.4");
        }
        return indicator;
    }

    private Span createAccessBadge(CalDavCalendar calendar) {
        var badge = new Span(calendar.accessible() ? "Accessible" : "Restricted");
        badge.getElement().getThemeList().add("badge " + (calendar.accessible() ? "success" : "contrast") + " small");
        return badge;
    }

    private static final DateTimeFormatter DATE_FORMATTER = DateTimeFormatter.ofPattern("EEE, MMM d");
    private static final DateTimeFormatter TIME_FORMATTER = DateTimeFormatter.ofPattern("HH:mm");

    private void showWeekEvents(CalDavCalendar calendar) {
        var url = urlField.getValue();
        var username = usernameField.getValue();
        var password = passwordField.getValue();

        if (url.isBlank() || username.isBlank() || password.isBlank()) {
            return;
        }

        try {
            var events = calDavService.fetchWeekEvents(
                    url, calendar.href(), username, password, calendar.accessible());

            var dialog = new Dialog();
            dialog.setHeaderTitle("This Week — " + calendar.displayName());
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
                var eventGrid = createEventGrid(calendar.accessible());
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

    private Grid<CalDavEvent> createEventGrid(boolean accessible) {
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

        if (accessible) {
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
            return start + " – " + event.endTime().format(TIME_FORMATTER);
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
        var includeAll = includeAllCheckbox.getValue();

        if (url.isBlank() || username.isBlank() || password.isBlank()) {
            Notification.show("Please fill in all fields.", 3000, Notification.Position.BOTTOM_CENTER)
                    .addThemeVariants(NotificationVariant.LUMO_WARNING);
            return;
        }

        connectButton.setEnabled(false);
        connectButton.setText("Connecting...");

        try {
            List<CalDavCalendar> calendars;
            if (includeAll) {
                calendars = calDavService.discoverAllCalendars(url, username, password);
            } else {
                calendars = calDavService.discoverCalendars(url, username, password);
            }
            calendarGrid.setItems(calendars);

            if (calendars.isEmpty()) {
                Notification.show("Connected successfully, but no calendars were found.", 5000,
                        Notification.Position.BOTTOM_CENTER);
            } else {
                var accessible = calendars.stream().filter(CalDavCalendar::accessible).count();
                var inaccessible = calendars.size() - accessible;
                var message = "Found " + calendars.size() + " calendar(s)";
                if (inaccessible > 0) {
                    message += " (" + accessible + " accessible, " + inaccessible + " restricted)";
                }
                message += ".";
                Notification.show(message, 3000, Notification.Position.BOTTOM_CENTER)
                        .addThemeVariants(NotificationVariant.LUMO_SUCCESS);
            }
        } catch (CalDavException e) {
            calendarGrid.setItems(List.of());
            Notification.show(e.getMessage(), 5000, Notification.Position.BOTTOM_CENTER)
                    .addThemeVariants(NotificationVariant.LUMO_ERROR);
        } finally {
            connectButton.setEnabled(true);
            connectButton.setText("Connect");
        }
    }
}
