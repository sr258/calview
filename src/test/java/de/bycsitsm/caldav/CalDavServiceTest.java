package de.bycsitsm.caldav;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThatThrownBy;

class CalDavServiceTest {

    private final CalDavClient calDavClient = new CalDavClient(false);
    private final CalDavService calDavService = new CalDavService(calDavClient);

    @Test
    void discover_users_rejects_blank_url() {
        assertThatThrownBy(() -> calDavService.discoverUsers("", "user", "pass"))
                .isInstanceOf(CalDavException.class)
                .hasMessageContaining("URL must not be empty");
    }

    @Test
    void discover_users_rejects_blank_username() {
        assertThatThrownBy(() -> calDavService.discoverUsers("https://example.com", "", "pass"))
                .isInstanceOf(CalDavException.class)
                .hasMessageContaining("Username must not be empty");
    }

    @Test
    void discover_users_rejects_blank_password() {
        assertThatThrownBy(() -> calDavService.discoverUsers("https://example.com", "user", ""))
                .isInstanceOf(CalDavException.class)
                .hasMessageContaining("Password must not be empty");
    }

    @Test
    void search_users_rejects_blank_search_term() {
        assertThatThrownBy(() -> calDavService.searchUsers("https://example.com", "user", "pass", ""))
                .isInstanceOf(CalDavException.class)
                .hasMessageContaining("Search term must not be empty");
    }

    @Test
    void search_users_rejects_null_search_term() {
        assertThatThrownBy(() -> calDavService.searchUsers("https://example.com", "user", "pass", null))
                .isInstanceOf(CalDavException.class)
                .hasMessageContaining("Search term must not be empty");
    }

    @Test
    void search_users_rejects_blank_url() {
        assertThatThrownBy(() -> calDavService.searchUsers("", "user", "pass", "test"))
                .isInstanceOf(CalDavException.class)
                .hasMessageContaining("URL must not be empty");
    }
}
