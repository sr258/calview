package de.bycsitsm.caldav;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThatThrownBy;

class CalDavServiceTest {

    private final CalDavClient calDavClient = new CalDavClient(false);
    private final CalDavService calDavService = new CalDavService(calDavClient);

    @Test
    void discover_calendars_rejects_blank_url() {
        assertThatThrownBy(() -> calDavService.discoverCalendars("", "user", "pass"))
                .isInstanceOf(CalDavException.class)
                .hasMessageContaining("URL must not be empty");
    }

    @Test
    void discover_calendars_rejects_blank_username() {
        assertThatThrownBy(() -> calDavService.discoverCalendars("https://example.com", "", "pass"))
                .isInstanceOf(CalDavException.class)
                .hasMessageContaining("Username must not be empty");
    }

    @Test
    void discover_calendars_rejects_blank_password() {
        assertThatThrownBy(() -> calDavService.discoverCalendars("https://example.com", "user", ""))
                .isInstanceOf(CalDavException.class)
                .hasMessageContaining("Password must not be empty");
    }
}
