package de.bycsitsm.caldav.ui;

import com.vaadin.flow.component.button.Button;
import com.vaadin.flow.component.button.ButtonVariant;
import com.vaadin.flow.component.checkbox.Checkbox;
import com.vaadin.flow.component.grid.Grid;
import com.vaadin.flow.component.grid.GridVariant;
import com.vaadin.flow.component.html.Div;
import com.vaadin.flow.component.html.Span;
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
import de.bycsitsm.caldav.CalDavException;
import de.bycsitsm.caldav.CalDavService;

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
