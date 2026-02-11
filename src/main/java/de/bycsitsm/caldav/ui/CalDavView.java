package de.bycsitsm.caldav.ui;

import com.vaadin.flow.component.button.Button;
import com.vaadin.flow.component.button.ButtonVariant;
import com.vaadin.flow.component.combobox.ComboBox;
import com.vaadin.flow.component.html.H3;
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
import com.vaadin.flow.router.Menu;
import com.vaadin.flow.router.PageTitle;
import com.vaadin.flow.router.Route;
import com.vaadin.flow.theme.lumo.LumoUtility;
import de.bycsitsm.base.ui.ViewToolbar;
import de.bycsitsm.caldav.CalDavException;
import de.bycsitsm.caldav.CalDavService;
import de.bycsitsm.caldav.CalDavUser;

import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.stream.Stream;

@Route("")
@PageTitle("Appointment Planner")
@Menu(order = 0, icon = "vaadin:calendar", title = "Planner")
class CalDavView extends VerticalLayout {

    private static final int MIN_SEARCH_LENGTH = 2;

    private final CalDavService calDavService;

    private final TextField urlField;
    private final TextField usernameField;
    private final PasswordField passwordField;
    private final Button connectButton;
    private final ComboBox<CalDavUser> userSearchBox;
    private final VerticalLayout selectedUsersLayout;
    private final Span selectedCountLabel;

    /** Tracks whether the user has successfully connected to the server. */
    private boolean connected;

    /** Maintains the set of selected users in insertion order. */
    private final Set<CalDavUser> selectedUsers = new LinkedHashSet<>();

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
        var toolbar = new ViewToolbar("Planner",
                ViewToolbar.group(urlField, usernameField, passwordField, connectButton));
        add(toolbar);

        // Main content area
        var content = new VerticalLayout();
        content.setPadding(true);
        content.setSpacing(true);
        content.setSizeFull();

        // User search ComboBox
        userSearchBox = createUserSearchBox();
        content.add(userSearchBox);

        // Selected users section
        var selectedHeader = new HorizontalLayout();
        selectedHeader.setDefaultVerticalComponentAlignment(FlexComponent.Alignment.BASELINE);
        selectedHeader.setSpacing(true);

        var selectedTitle = new H3("Selected Users");
        selectedTitle.addClassNames(LumoUtility.Margin.Top.MEDIUM, LumoUtility.Margin.Bottom.NONE);

        selectedCountLabel = new Span("(0)");
        selectedCountLabel.addClassNames(LumoUtility.TextColor.SECONDARY, LumoUtility.FontSize.SMALL);

        selectedHeader.add(selectedTitle, selectedCountLabel);
        content.add(selectedHeader);

        selectedUsersLayout = new VerticalLayout();
        selectedUsersLayout.setPadding(false);
        selectedUsersLayout.setSpacing(false);
        selectedUsersLayout.setWidthFull();
        content.add(selectedUsersLayout);

        add(content);

        updateSelectedUsersDisplay();
    }

    private ComboBox<CalDavUser> createUserSearchBox() {
        var comboBox = new ComboBox<CalDavUser>("Search Users");
        comboBox.setPlaceholder("Type at least " + MIN_SEARCH_LENGTH + " characters to search...");
        comboBox.setWidthFull();
        comboBox.setClearButtonVisible(true);
        comboBox.setEnabled(false);
        comboBox.setPrefixComponent(VaadinIcon.SEARCH.create());
        comboBox.setItemLabelGenerator(CalDavUser::displayName);
        comboBox.getStyle().set("--vaadin-combo-box-overlay-width", "400px");

        // Fetch callback: queries the CalDAV server for matching users.
        // The query contract requires calling getOffset()/getLimit() even though
        // the CalDAV server returns all results at once (up to its own limit of 100).
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

        // When a user is selected from the dropdown, add them to the list
        comboBox.addValueChangeListener(event -> {
            var user = event.getValue();
            if (user != null) {
                addSelectedUser(user);
                // Clear the ComboBox after selection so the user can search again
                comboBox.clear();
            }
        });

        return comboBox;
    }

    private List<CalDavUser> searchUsersOnServer(String searchTerm) {
        var url = urlField.getValue();
        var username = usernameField.getValue();
        var password = passwordField.getValue();

        if (!connected || url.isBlank() || username.isBlank() || password.isBlank()) {
            return List.of();
        }

        try {
            var results = calDavService.searchUsers(url, username, password, searchTerm);
            // Filter out already-selected users from search results
            return results.stream()
                    .filter(user -> !selectedUsers.contains(user))
                    .toList();
        } catch (CalDavException e) {
            // Log but don't show error notification for every keystroke search failure
            return List.of();
        }
    }

    private void addSelectedUser(CalDavUser user) {
        if (selectedUsers.add(user)) {
            updateSelectedUsersDisplay();
        }
    }

    private void removeSelectedUser(CalDavUser user) {
        if (selectedUsers.remove(user)) {
            updateSelectedUsersDisplay();
        }
    }

    private void updateSelectedUsersDisplay() {
        selectedUsersLayout.removeAll();
        selectedCountLabel.setText("(" + selectedUsers.size() + ")");

        if (selectedUsers.isEmpty()) {
            var emptyMessage = new Span("No users selected. Use the search box above to find and add users.");
            emptyMessage.addClassNames(LumoUtility.TextColor.SECONDARY, LumoUtility.Padding.MEDIUM);
            selectedUsersLayout.add(emptyMessage);
            return;
        }

        for (var user : selectedUsers) {
            selectedUsersLayout.add(createSelectedUserRow(user));
        }
    }

    private HorizontalLayout createSelectedUserRow(CalDavUser user) {
        var row = new HorizontalLayout();
        row.setWidthFull();
        row.setDefaultVerticalComponentAlignment(FlexComponent.Alignment.CENTER);
        row.addClassNames(LumoUtility.Padding.Horizontal.MEDIUM,
                LumoUtility.Padding.Vertical.SMALL);
        row.getStyle().set("border-bottom", "1px solid var(--lumo-contrast-10pct)");

        var userIcon = VaadinIcon.USER.create();
        userIcon.addClassNames(LumoUtility.TextColor.SECONDARY);
        userIcon.setSize("var(--lumo-icon-size-s)");

        var nameLabel = new Span(user.displayName());
        nameLabel.addClassNames(LumoUtility.FontWeight.MEDIUM);

        var pathLabel = new Span(user.href());
        pathLabel.addClassNames(LumoUtility.TextColor.SECONDARY, LumoUtility.FontSize.SMALL);

        var nameAndPath = new VerticalLayout(nameLabel, pathLabel);
        nameAndPath.setPadding(false);
        nameAndPath.setSpacing(false);

        var removeButton = new Button(new Icon("lumo", "cross"), event -> removeSelectedUser(user));
        removeButton.addThemeVariants(ButtonVariant.LUMO_TERTIARY, ButtonVariant.LUMO_SMALL,
                ButtonVariant.LUMO_ERROR);
        removeButton.setTooltipText("Remove " + user.displayName());

        row.add(userIcon, nameAndPath, removeButton);
        row.setFlexGrow(1, nameAndPath);

        return row;
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
            // Verify the connection by performing a minimal search
            calDavService.searchUsers(url, username, password, "a");
            connected = true;
            userSearchBox.setEnabled(true);

            Notification.show("Connected successfully. You can now search for users.", 3000,
                            Notification.Position.BOTTOM_CENTER)
                    .addThemeVariants(NotificationVariant.LUMO_SUCCESS);
        } catch (CalDavException e) {
            connected = false;
            userSearchBox.setEnabled(false);
            Notification.show(e.getMessage(), 5000, Notification.Position.BOTTOM_CENTER)
                    .addThemeVariants(NotificationVariant.LUMO_ERROR);
        } finally {
            connectButton.setEnabled(true);
            connectButton.setText("Connect");
        }
    }
}
