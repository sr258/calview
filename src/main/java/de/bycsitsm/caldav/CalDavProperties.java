package de.bycsitsm.caldav;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Configuration properties for CalDAV integration.
 *
 * @param defaultUrl the default CalDAV server URL pre-filled in the login dialog
 */
@ConfigurationProperties(prefix = "caldav")
public record CalDavProperties(String defaultUrl) {

    public CalDavProperties {
        if (defaultUrl == null) {
            defaultUrl = "";
        }
    }
}
