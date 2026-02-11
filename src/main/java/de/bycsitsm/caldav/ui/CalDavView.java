package de.bycsitsm.caldav.ui;

import com.vaadin.flow.component.AttachEvent;
import com.vaadin.flow.component.button.Button;
import com.vaadin.flow.component.button.ButtonVariant;
import com.vaadin.flow.component.combobox.ComboBox;
import com.vaadin.flow.component.dialog.Dialog;
import com.vaadin.flow.component.formlayout.FormLayout;
import com.vaadin.flow.component.grid.ColumnRendering;
import com.vaadin.flow.component.grid.Grid;
import com.vaadin.flow.component.html.Span;
import com.vaadin.flow.component.icon.Icon;
import com.vaadin.flow.component.icon.VaadinIcon;
import com.vaadin.flow.component.notification.Notification;
import com.vaadin.flow.component.notification.NotificationVariant;
import com.vaadin.flow.component.orderedlayout.FlexComponent;
import com.vaadin.flow.component.orderedlayout.HorizontalLayout;
import com.vaadin.flow.component.orderedlayout.VerticalLayout;
import com.vaadin.flow.component.textfield.PasswordField;
import com.vaadin.flow.component.textfield.TextField;
import com.vaadin.flow.data.renderer.ComponentRenderer;
import com.vaadin.flow.data.renderer.LitRenderer;
import com.vaadin.flow.router.Menu;
import com.vaadin.flow.router.PageTitle;
import com.vaadin.flow.router.Route;
import de.bycsitsm.base.ui.ViewToolbar;
import de.bycsitsm.caldav.CalDavEvent;
import de.bycsitsm.caldav.CalDavException;
import de.bycsitsm.caldav.CalDavProperties;
import de.bycsitsm.caldav.CalDavService;
import de.bycsitsm.caldav.CalDavUser;
import org.jspecify.annotations.Nullable;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.format.DateTimeFormatter;
import java.time.temporal.TemporalAdjusters;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Stream;

/**
 * Main view for the appointment planner. Allows connecting to a CalDAV server,
 * searching for users, and displaying a weekly schedule grid showing busy/free
 * times for all selected users.
 * <p>
 * The schedule grid has one row per user (plus an "All Free" summary row),
 * with time slots as columns (30-minute increments from 7:00 to 19:00,
 * Monday through Friday). Cells are color-coded by status and show tooltips
 * with event details when the calendar is accessible.
 */
@Route("")
@PageTitle("Appointment Planner")
@Menu(order = 0, icon = "vaadin:calendar", title = "Planner")
class CalDavView extends VerticalLayout {

    private static final Logger log = LoggerFactory.getLogger(CalDavView.class);

    private static final int MIN_SEARCH_LENGTH = 2;

    /** Time range for the schedule grid: 7:00 to 19:00 (exclusive) */
    private static final LocalTime SCHEDULE_START = LocalTime.of(7, 0);
    private static final LocalTime SCHEDULE_END = LocalTime.of(19, 0);

    /** 30-minute slot duration */
    private static final int SLOT_MINUTES = 30;

    /** Weekdays to display (Monday through Friday) */
    private static final DayOfWeek[] WEEKDAYS = {
            DayOfWeek.MONDAY, DayOfWeek.TUESDAY, DayOfWeek.WEDNESDAY,
            DayOfWeek.THURSDAY, DayOfWeek.FRIDAY
    };

    private static final String[] DAY_SHORT_NAMES = {"Mon", "Tue", "Wed", "Thu", "Fri"};

    private static final DateTimeFormatter DATE_FORMATTER = DateTimeFormatter.ofPattern("MMM d");
    private static final DateTimeFormatter TIME_FORMATTER = DateTimeFormatter.ofPattern("H:mm");

    private final CalDavService calDavService;
    private final CalDavProperties calDavProperties;

    // Toolbar connection controls
    private final Button loginButton;
    private final Span connectionStatus;
    private final ComboBox<CalDavUser> userSearchBox;

    // Week navigation
    private final Span weekLabel;
    private final Button prevWeekButton;
    private final Button nextWeekButton;
    private final Button todayButton;

    // Schedule container
    private final VerticalLayout scheduleContainer;

    /** Tracks whether the user has successfully connected to the server. */
    private boolean connected;

    /** Stored credentials from the login dialog (set after successful connection). */
    private @Nullable String connectedUrl;
    private @Nullable String connectedUsername;
    private @Nullable String connectedPassword;

    /** Maintains the set of selected users in insertion order. */
    private final Set<CalDavUser> selectedUsers = new LinkedHashSet<>();

    /** The Monday of the currently displayed week. */
    private LocalDate currentWeekStart;

    /** Cached events per user for the current week. */
    private final Map<CalDavUser, List<CalDavEvent>> userEvents = new LinkedHashMap<>();

    /** Users whose event fetch failed. */
    private final Set<CalDavUser> failedUsers = new LinkedHashSet<>();

    /** Pre-computed time slot start times (7:00, 7:30, 8:00, ..., 18:30). */
    private final List<LocalTime> timeSlots;

    /** Slot keys used as column identifiers: "0-07:00", "0-07:30", ..., "4-18:30". */
    private final List<String> slotKeys;

    CalDavView(CalDavService calDavService, CalDavProperties calDavProperties) {
        this.calDavService = calDavService;
        this.calDavProperties = calDavProperties;

        setSizeFull();
        setPadding(false);
        setSpacing(false);

        // Pre-compute time slots
        timeSlots = new ArrayList<>();
        slotKeys = new ArrayList<>();
        for (var time = SCHEDULE_START; time.isBefore(SCHEDULE_END); time = time.plusMinutes(SLOT_MINUTES)) {
            timeSlots.add(time);
        }
        for (int dayIdx = 0; dayIdx < WEEKDAYS.length; dayIdx++) {
            for (var time : timeSlots) {
                slotKeys.add(dayIdx + "-" + time.format(TIME_FORMATTER));
            }
        }

        // Initialize current week
        currentWeekStart = LocalDate.now().with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY));

        // --- Toolbar with login button and connection status ---
        connectionStatus = new Span("Not connected");
        connectionStatus.getStyle()
                .set("color", "var(--lumo-secondary-text-color)")
                .set("font-size", "var(--lumo-font-size-s)");

        loginButton = new Button("Connect", VaadinIcon.CONNECT.create(), event -> openLoginDialog());
        loginButton.addThemeVariants(ButtonVariant.LUMO_PRIMARY);

        var toolbar = new ViewToolbar("Planner",
                ViewToolbar.group(connectionStatus, loginButton));
        add(toolbar);

        // --- Main content area ---
        var content = new VerticalLayout();
        content.setPadding(true);
        content.setSpacing(true);
        content.setSizeFull();

        // User search ComboBox
        userSearchBox = createUserSearchBox();
        content.add(userSearchBox);

        // Week navigation bar
        prevWeekButton = new Button(VaadinIcon.ANGLE_LEFT.create(), e -> navigateWeek(-1));
        prevWeekButton.addThemeVariants(ButtonVariant.LUMO_TERTIARY);
        prevWeekButton.setTooltipText("Previous week");
        prevWeekButton.setEnabled(false);

        todayButton = new Button("Today", e -> navigateToToday());
        todayButton.addThemeVariants(ButtonVariant.LUMO_TERTIARY);
        todayButton.setEnabled(false);

        nextWeekButton = new Button(VaadinIcon.ANGLE_RIGHT.create(), e -> navigateWeek(1));
        nextWeekButton.addThemeVariants(ButtonVariant.LUMO_TERTIARY);
        nextWeekButton.setTooltipText("Next week");
        nextWeekButton.setEnabled(false);

        weekLabel = new Span();
        weekLabel.addClassName("week-label");
        updateWeekLabel();

        var weekNav = new HorizontalLayout(prevWeekButton, todayButton, weekLabel, nextWeekButton);
        weekNav.addClassName("week-nav");
        weekNav.setDefaultVerticalComponentAlignment(FlexComponent.Alignment.CENTER);
        weekNav.setWidthFull();
        content.add(weekNav);

        // Schedule container
        scheduleContainer = new VerticalLayout();
        scheduleContainer.setPadding(false);
        scheduleContainer.setSpacing(false);
        scheduleContainer.setSizeFull();

        var emptyMessage = new Span("No users selected. Use the search box above to find and add users.");
        emptyMessage.getStyle()
                .set("color", "var(--lumo-secondary-text-color)")
                .set("padding", "var(--lumo-space-l)")
                .set("text-align", "center");
        scheduleContainer.add(emptyMessage);

        content.add(scheduleContainer);
        content.setFlexGrow(1, scheduleContainer);

        add(content);
    }

    // =========================================================================
    // User Search
    // =========================================================================

    private ComboBox<CalDavUser> createUserSearchBox() {
        var comboBox = new ComboBox<CalDavUser>("Search Users");
        comboBox.setPlaceholder("Type at least " + MIN_SEARCH_LENGTH + " characters to search...");
        comboBox.setWidthFull();
        comboBox.setClearButtonVisible(true);
        comboBox.setEnabled(false);
        comboBox.setPrefixComponent(VaadinIcon.SEARCH.create());
        comboBox.setItemLabelGenerator(CalDavUser::displayName);
        comboBox.getStyle().set("--vaadin-combo-box-overlay-width", "400px");

        comboBox.setItems(query -> {
            var filter = query.getFilter().orElse("");
            var offset = query.getOffset();
            var limit = query.getLimit();
            if (filter.length() < MIN_SEARCH_LENGTH) {
                return Stream.empty();
            }
            return searchUsersOnServer(filter).stream()
                    .skip(offset)
                    .limit(limit);
        });

        comboBox.addValueChangeListener(event -> {
            var user = event.getValue();
            if (user != null) {
                addSelectedUser(user);
                comboBox.clear();
            }
        });

        return comboBox;
    }

    private List<CalDavUser> searchUsersOnServer(String searchTerm) {
        if (!connected || connectedUrl == null || connectedUsername == null || connectedPassword == null) {
            return List.of();
        }

        try {
            var results = calDavService.searchUsers(connectedUrl, connectedUsername, connectedPassword, searchTerm);
            return results.stream()
                    .filter(user -> !selectedUsers.contains(user))
                    .toList();
        } catch (CalDavException e) {
            return List.of();
        }
    }

    // =========================================================================
    // User Selection
    // =========================================================================

    private void addSelectedUser(CalDavUser user) {
        if (selectedUsers.add(user)) {
            fetchEventsForUser(user);
            rebuildScheduleGrid();
        }
    }

    private void removeSelectedUser(CalDavUser user) {
        if (selectedUsers.remove(user)) {
            userEvents.remove(user);
            failedUsers.remove(user);
            rebuildScheduleGrid();
        }
    }

    // =========================================================================
    // Week Navigation
    // =========================================================================

    private void navigateWeek(int offset) {
        currentWeekStart = currentWeekStart.plusWeeks(offset);
        updateWeekLabel();
        refreshAllEvents();
    }

    private void navigateToToday() {
        currentWeekStart = LocalDate.now().with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY));
        updateWeekLabel();
        refreshAllEvents();
    }

    private void updateWeekLabel() {
        var weekEnd = currentWeekStart.plusDays(4); // Friday
        weekLabel.setText(
                currentWeekStart.format(DATE_FORMATTER) + " - " + weekEnd.format(DATE_FORMATTER)
                        + ", " + currentWeekStart.getYear());
    }

    private void setWeekNavigationEnabled(boolean enabled) {
        prevWeekButton.setEnabled(enabled);
        nextWeekButton.setEnabled(enabled);
        todayButton.setEnabled(enabled);
    }

    // =========================================================================
    // Data Fetching
    // =========================================================================

    private void fetchEventsForUser(CalDavUser user) {
        if (connectedUrl == null || connectedUsername == null || connectedPassword == null) {
            return;
        }

        try {
            var events = calDavService.fetchWeekEvents(connectedUrl, user.href(),
                    connectedUsername, connectedPassword, currentWeekStart);
            userEvents.put(user, events);
            failedUsers.remove(user);
        } catch (CalDavException e) {
            log.warn("Failed to fetch events for user {}: {}", user.displayName(), e.getMessage());
            userEvents.put(user, List.of());
            failedUsers.add(user);
            Notification.show("Could not load events for " + user.displayName() + ": " + e.getMessage(),
                            5000, Notification.Position.BOTTOM_CENTER)
                    .addThemeVariants(NotificationVariant.LUMO_WARNING);
        }
    }

    private void refreshAllEvents() {
        userEvents.clear();
        failedUsers.clear();
        for (var user : selectedUsers) {
            fetchEventsForUser(user);
        }
        rebuildScheduleGrid();
    }

    // =========================================================================
    // Schedule Grid Construction
    // =========================================================================

    /**
     * Completely rebuilds the schedule grid columns and data.
     * Called when users are added/removed or the week changes.
     */
    private void rebuildScheduleGrid() {
        scheduleContainer.removeAll();

        if (selectedUsers.isEmpty()) {
            setWeekNavigationEnabled(false);
            var emptyMessage = new Span("No users selected. Use the search box above to find and add users.");
            emptyMessage.getStyle()
                    .set("color", "var(--lumo-secondary-text-color)")
                    .set("padding", "var(--lumo-space-l)")
                    .set("text-align", "center");
            scheduleContainer.add(emptyMessage);
            return;
        }

        setWeekNavigationEnabled(true);

        // Build fresh grid (column structure depends on selected users)
        var grid = new Grid<ScheduleRow>();
        grid.setColumnRendering(ColumnRendering.LAZY);
        grid.setAllRowsVisible(true);
        grid.addClassName("schedule-grid");
        grid.setSelectionMode(Grid.SelectionMode.NONE);

        // First column: user name (frozen)
        grid.addColumn(new ComponentRenderer<>(this::createUserCell))
                .setHeader("User")
                .setFrozen(true)
                .setAutoWidth(true)
                .setFlexGrow(0)
                .setKey("user");

        // Time-slot columns: grouped by day
        // We need to collect columns per day for the header row grouping
        var dayColumnGroups = new ArrayList<List<Grid.Column<ScheduleRow>>>();

        for (int dayIdx = 0; dayIdx < WEEKDAYS.length; dayIdx++) {
            var dayColumns = new ArrayList<Grid.Column<ScheduleRow>>();
            var dayDate = currentWeekStart.plusDays(dayIdx);

            for (int slotIdx = 0; slotIdx < timeSlots.size(); slotIdx++) {
                var time = timeSlots.get(slotIdx);
                var key = dayIdx + "-" + time.format(TIME_FORMATTER);
                var isFirstSlotOfDay = slotIdx == 0;
                var isFullHour = time.getMinute() == 0;

                // Header: show time label for full hours, empty for half-hours
                var headerLabel = isFullHour ? time.format(TIME_FORMATTER) : "";

                Grid.Column<ScheduleRow> column = grid.addColumn(createSlotRenderer(key))
                        .setHeader(headerLabel)
                        .setKey(key)
                        .setWidth("40px")
                        .setFlexGrow(0)
                        .setSortable(false)
                        .setResizable(false);

                if (isFirstSlotOfDay) {
                    column.setPartNameGenerator(row -> "day-separator");
                }

                dayColumns.add(column);
            }
            dayColumnGroups.add(dayColumns);
        }

        // Add top header row with day names spanning across their time columns
        var topHeader = grid.prependHeaderRow();
        for (int dayIdx = 0; dayIdx < WEEKDAYS.length; dayIdx++) {
            var dayDate = currentWeekStart.plusDays(dayIdx);
            var label = DAY_SHORT_NAMES[dayIdx] + " " + dayDate.format(DATE_FORMATTER);
            var columns = dayColumnGroups.get(dayIdx);
            if (!columns.isEmpty()) {
                topHeader.join(columns.toArray(new Grid.Column[0])).setText(label);
            }
        }

        // Build row data
        var rows = buildScheduleRows();
        grid.setItems(rows);

        // Set tooltip generator globally
        grid.setTooltipGenerator(row -> null); // disable default row tooltip

        scheduleContainer.add(grid);
        scheduleContainer.setFlexGrow(1, grid);
    }

    /**
     * Creates a LitRenderer for a single time-slot column.
     * The renderer displays a colored div based on the slot status,
     * with a tooltip showing event details when available.
     */
    private LitRenderer<ScheduleRow> createSlotRenderer(String slotKey) {
        return LitRenderer.<ScheduleRow>of(
                        "<div class=\"schedule-cell ${item.cssClass}\" title=\"${item.tooltip}\">"
                                + "${item.label}</div>")
                .withProperty("cssClass", row -> {
                    var slot = row.slots().get(slotKey);
                    return slot != null ? slot.cssClass() : "";
                })
                .withProperty("tooltip", row -> {
                    var slot = row.slots().get(slotKey);
                    return slot != null && slot.tooltip() != null ? slot.tooltip() : "";
                })
                .withProperty("label", row -> {
                    var slot = row.slots().get(slotKey);
                    return slot != null && slot.label() != null ? slot.label() : "";
                });
    }

    /**
     * Creates the user cell component for the frozen first column.
     * Shows user name + remove button for regular rows, or "All Free" label for the summary row.
     */
    private HorizontalLayout createUserCell(ScheduleRow row) {
        var layout = new HorizontalLayout();
        layout.addClassName("schedule-user-cell");
        layout.setDefaultVerticalComponentAlignment(FlexComponent.Alignment.CENTER);
        layout.setSpacing(true);
        layout.setPadding(false);

        if (row.user() != null) {
            var nameSpan = new Span(row.user().displayName());
            nameSpan.addClassName("user-name");

            if (failedUsers.contains(row.user())) {
                var errorIcon = VaadinIcon.WARNING.create();
                errorIcon.setSize("var(--lumo-icon-size-s)");
                errorIcon.getStyle().set("color", "var(--lumo-error-text-color)");
                errorIcon.setTooltipText("Failed to load events");
                layout.add(errorIcon);
            }

            var removeButton = new Button(new Icon("lumo", "cross"), event -> removeSelectedUser(row.user()));
            removeButton.addThemeVariants(ButtonVariant.LUMO_TERTIARY, ButtonVariant.LUMO_SMALL,
                    ButtonVariant.LUMO_ERROR);
            removeButton.setTooltipText("Remove " + row.user().displayName());

            layout.add(nameSpan, removeButton);
            layout.setFlexGrow(1, nameSpan);
        } else {
            // "All Free" summary row
            var label = new Span("All Free");
            label.addClassName("schedule-summary-cell");
            layout.add(label);
        }

        return layout;
    }

    // =========================================================================
    // Schedule Data Model & Computation
    // =========================================================================

    /**
     * Builds the list of schedule rows: one per user + the "All Free" summary row.
     */
    private List<ScheduleRow> buildScheduleRows() {
        var rows = new ArrayList<ScheduleRow>();

        // One row per user
        for (var user : selectedUsers) {
            var events = userEvents.getOrDefault(user, List.of());
            var slots = computeUserSlots(user, events);
            rows.add(new ScheduleRow(user, slots));
        }

        // "All Free" summary row
        var allFreeSlots = computeAllFreeSlots(rows);
        rows.add(new ScheduleRow(null, allFreeSlots));

        return rows;
    }

    /**
     * Computes slot statuses for a single user based on their events.
     */
    private Map<String, SlotInfo> computeUserSlots(CalDavUser user, List<CalDavEvent> events) {
        var slots = new HashMap<String, SlotInfo>();
        boolean hasFailed = failedUsers.contains(user);

        for (int dayIdx = 0; dayIdx < WEEKDAYS.length; dayIdx++) {
            var dayDate = currentWeekStart.plusDays(dayIdx);

            // Get events for this day
            var dayEvents = filterEventsForDay(events, dayDate);

            for (var time : timeSlots) {
                var key = dayIdx + "-" + time.format(TIME_FORMATTER);
                var slotEnd = time.plusMinutes(SLOT_MINUTES);

                if (hasFailed) {
                    slots.put(key, new SlotInfo("schedule-error-cell", "?", "Failed to load", true));
                    continue;
                }

                // Find events that overlap with this slot
                var overlapping = findOverlappingEvents(dayEvents, time, slotEnd);

                if (overlapping.isEmpty()) {
                    // Free slot
                    slots.put(key, new SlotInfo("", null, null, false));
                } else {
                    // Busy slot - determine the most significant event for display
                    var primaryEvent = selectPrimaryEvent(overlapping);
                    var cssClass = getCssClassForEvent(primaryEvent);
                    var label = getSlotLabel(primaryEvent);
                    var tooltip = buildTooltip(overlapping, time, slotEnd);

                    slots.put(key, new SlotInfo(cssClass, label, tooltip, true));
                }
            }
        }

        return slots;
    }

    /**
     * Computes the "All Free" row slots based on all user rows.
     */
    private Map<String, SlotInfo> computeAllFreeSlots(List<ScheduleRow> userRows) {
        var slots = new HashMap<String, SlotInfo>();

        for (var key : slotKeys) {
            boolean allFree = userRows.stream()
                    .noneMatch(row -> {
                        var slot = row.slots().get(key);
                        return slot != null && slot.busy();
                    });

            if (allFree) {
                slots.put(key, new SlotInfo("slot-all-free", null, "All users are free", false));
            } else {
                slots.put(key, new SlotInfo("slot-not-all-free", null, null, true));
            }
        }

        return slots;
    }

    /**
     * Filters events to those occurring on a specific day.
     */
    private List<CalDavEvent> filterEventsForDay(List<CalDavEvent> events, LocalDate day) {
        return events.stream()
                .filter(e -> e.date().equals(day))
                .toList();
    }

    /**
     * Finds events that overlap with the given time slot.
     * A slot [slotStart, slotEnd) is overlapped by an event if:
     * event.startTime < slotEnd AND event.endTime > slotStart.
     * All-day events (null start/end times) overlap all slots.
     */
    private List<CalDavEvent> findOverlappingEvents(List<CalDavEvent> dayEvents,
                                                     LocalTime slotStart, LocalTime slotEnd) {
        return dayEvents.stream()
                .filter(event -> {
                    // All-day events overlap every slot
                    if (event.startTime() == null || event.endTime() == null) {
                        return true;
                    }
                    // Standard overlap check: event.start < slotEnd && event.end > slotStart
                    return event.startTime().isBefore(slotEnd) && event.endTime().isAfter(slotStart);
                })
                .toList();
    }

    /**
     * Selects the most "significant" event for display when multiple events
     * overlap a slot. Priority: BUSY-UNAVAILABLE > BUSY > BUSY-TENTATIVE > other.
     * Among equal priority, prefers accessible events (which have details).
     */
    private CalDavEvent selectPrimaryEvent(List<CalDavEvent> events) {
        CalDavEvent best = events.get(0);
        for (var event : events) {
            if (eventPriority(event) > eventPriority(best)) {
                best = event;
            } else if (eventPriority(event) == eventPriority(best) && event.accessible() && !best.accessible()) {
                best = event;
            }
        }
        return best;
    }

    private int eventPriority(CalDavEvent event) {
        return switch (event.status()) {
            case "BUSY-UNAVAILABLE" -> 3;
            case "BUSY" -> 2;
            case "BUSY-TENTATIVE" -> 1;
            default -> 2; // PUBLIC, PRIVATE, CONFIDENTIAL from calendar-query are treated as BUSY
        };
    }

    /**
     * Determines the CSS class for a slot based on the primary event.
     */
    private String getCssClassForEvent(CalDavEvent event) {
        if (event.accessible()) {
            // Full calendar access - blue
            return "slot-busy";
        }
        // Free-busy only - color based on FBTYPE
        return switch (event.status()) {
            case "BUSY-TENTATIVE" -> "slot-busy-tentative";
            case "BUSY-UNAVAILABLE" -> "slot-busy-unavailable";
            default -> "slot-busy-fb";
        };
    }

    /**
     * Returns a short label for a slot cell. Shows the event summary
     * (truncated) for accessible events, or empty for free-busy only.
     */
    private @Nullable String getSlotLabel(CalDavEvent event) {
        if (event.accessible() && event.summary() != null) {
            var summary = event.summary();
            return summary.length() > 8 ? summary.substring(0, 7) + "\u2026" : summary;
        }
        return null;
    }

    /**
     * Builds a tooltip string listing all overlapping events in a slot.
     * Shows event summaries and exact times for accessible events,
     * or just the busy type for free-busy-only events.
     */
    private @Nullable String buildTooltip(List<CalDavEvent> events, LocalTime slotStart, LocalTime slotEnd) {
        if (events.isEmpty()) {
            return null;
        }

        var sb = new StringBuilder();
        for (int i = 0; i < events.size(); i++) {
            if (i > 0) {
                sb.append("\n");
            }
            var event = events.get(i);
            if (event.accessible() && event.summary() != null) {
                sb.append(event.summary());
                if (event.startTime() != null && event.endTime() != null) {
                    sb.append(" (").append(event.startTime().format(TIME_FORMATTER))
                            .append(" - ").append(event.endTime().format(TIME_FORMATTER)).append(")");
                }
            } else {
                // Free-busy only
                sb.append(event.status());
                if (event.startTime() != null && event.endTime() != null) {
                    sb.append(" (").append(event.startTime().format(TIME_FORMATTER))
                            .append(" - ").append(event.endTime().format(TIME_FORMATTER)).append(")");
                }
            }
        }
        return sb.toString();
    }

    // =========================================================================
    // Connection
    // =========================================================================

    /**
     * Opens the login dialog for connecting to a CalDAV server.
     * Pre-fills the URL field with the configured default URL.
     */
    private void openLoginDialog() {
        var dialog = new Dialog();
        dialog.setHeaderTitle("Connect to CalDAV Server");
        dialog.setCloseOnOutsideClick(connected);
        dialog.setCloseOnEsc(connected);
        dialog.setWidth("450px");

        var urlField = new TextField("CalDAV URL");
        urlField.setWidthFull();
        urlField.setClearButtonVisible(true);
        urlField.setValue(connectedUrl != null ? connectedUrl : calDavProperties.defaultUrl());

        var usernameField = new TextField("Username");
        usernameField.setWidthFull();
        usernameField.setClearButtonVisible(true);
        if (connectedUsername != null) {
            usernameField.setValue(connectedUsername);
        }

        var passwordField = new PasswordField("Password");
        passwordField.setWidthFull();

        var formLayout = new FormLayout(urlField, usernameField, passwordField);
        formLayout.setResponsiveSteps(new FormLayout.ResponsiveStep("0", 1));
        dialog.add(formLayout);

        var connectButton = new Button("Connect", event -> {
            var url = urlField.getValue();
            var username = usernameField.getValue();
            var password = passwordField.getValue();

            if (url.isBlank() || username.isBlank() || password.isBlank()) {
                Notification.show("Please fill in all fields.", 3000, Notification.Position.BOTTOM_CENTER)
                        .addThemeVariants(NotificationVariant.LUMO_WARNING);
                return;
            }

            event.getSource().setEnabled(false);
            event.getSource().setText("Connecting...");

            try {
                calDavService.searchUsers(url, username, password, "a");

                connectedUrl = url;
                connectedUsername = username;
                connectedPassword = password;
                connected = true;

                userSearchBox.setEnabled(true);
                updateConnectionStatus();

                dialog.close();

                Notification.show("Connected successfully. You can now search for users.", 3000,
                                Notification.Position.BOTTOM_CENTER)
                        .addThemeVariants(NotificationVariant.LUMO_SUCCESS);
            } catch (CalDavException e) {
                Notification.show(e.getMessage(), 5000, Notification.Position.BOTTOM_CENTER)
                        .addThemeVariants(NotificationVariant.LUMO_ERROR);
            } finally {
                event.getSource().setEnabled(true);
                event.getSource().setText("Connect");
            }
        });
        connectButton.addThemeVariants(ButtonVariant.LUMO_PRIMARY);

        var cancelButton = new Button("Cancel", event -> dialog.close());
        cancelButton.addThemeVariants(ButtonVariant.LUMO_TERTIARY);
        cancelButton.setVisible(connected);

        dialog.getFooter().add(cancelButton, connectButton);

        dialog.open();

        // Focus the appropriate field
        if (urlField.getValue().isBlank()) {
            urlField.focus();
        } else if (usernameField.getValue().isBlank()) {
            usernameField.focus();
        } else {
            passwordField.focus();
        }
    }

    /**
     * Disconnects from the CalDAV server and resets state.
     */
    private void disconnect() {
        connected = false;
        connectedUrl = null;
        connectedUsername = null;
        connectedPassword = null;

        userSearchBox.setEnabled(false);
        selectedUsers.clear();
        userEvents.clear();
        failedUsers.clear();
        rebuildScheduleGrid();
        updateConnectionStatus();
    }

    /**
     * Updates the toolbar connection status and button label.
     */
    private void updateConnectionStatus() {
        if (connected && connectedUsername != null) {
            connectionStatus.setText("Connected as " + connectedUsername);
            connectionStatus.getStyle().set("color", "var(--lumo-success-text-color)");
            loginButton.setText("Reconnect");
            loginButton.setIcon(VaadinIcon.CONNECT.create());
        } else {
            connectionStatus.setText("Not connected");
            connectionStatus.getStyle().set("color", "var(--lumo-secondary-text-color)");
            loginButton.setText("Connect");
            loginButton.setIcon(VaadinIcon.CONNECT.create());
        }
    }

    @Override
    protected void onAttach(AttachEvent attachEvent) {
        super.onAttach(attachEvent);
        if (!connected) {
            openLoginDialog();
        }
    }

    // =========================================================================
    // Inner Records
    // =========================================================================

    /**
     * Represents a single row in the schedule grid.
     *
     * @param user  the user for this row, or {@code null} for the "All Free" summary row
     * @param slots map of slot key (e.g. "0-07:00") to slot info
     */
    record ScheduleRow(@Nullable CalDavUser user, Map<String, SlotInfo> slots) {
    }

    /**
     * Represents the display state of a single cell in the schedule grid.
     *
     * @param cssClass the CSS class to apply to the cell div
     * @param label    short text to display in the cell (may be null)
     * @param tooltip  tooltip text (may be null)
     * @param busy     whether this slot is considered busy (used for "All Free" calculation)
     */
    record SlotInfo(String cssClass, @Nullable String label, @Nullable String tooltip, boolean busy) {
    }
}
