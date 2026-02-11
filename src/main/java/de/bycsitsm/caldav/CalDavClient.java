package de.bycsitsm.caldav;

import org.jspecify.annotations.Nullable;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.w3c.dom.Element;
import org.xml.sax.InputSource;

import javax.net.ssl.SSLContext;
import javax.net.ssl.TrustManager;
import javax.net.ssl.X509TrustManager;
import javax.xml.parsers.DocumentBuilderFactory;
import java.io.IOException;
import java.io.StringReader;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.security.KeyManagementException;
import java.security.NoSuchAlgorithmException;
import java.security.cert.X509Certificate;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;

/**
 * Low-level CalDAV protocol client that communicates with CalDAV servers
 * using Java's built-in {@link HttpClient}.
 * <p>
 * Supports PROPFIND requests for calendar discovery, including two-level
 * discovery where the given URL points to a server root containing principals
 * rather than calendars directly (e.g. DAViCal's {@code /caldav.php/}).
 * <p>
 * Also supports discovering all principals on the server via the
 * {@code principal-property-search} REPORT method (RFC 3744), which allows
 * listing calendars from users whose calendars are not shared with the
 * current user.
 */
@Component
class CalDavClient {

    private static final Logger log = LoggerFactory.getLogger(CalDavClient.class);

    private static final String DAV_NS = "DAV:";
    private static final String CALDAV_NS = "urn:ietf:params:xml:ns:caldav";
    private static final String APPLE_ICAL_NS = "http://apple.com/ns/ical/";
    private static final String CALENDARSERVER_NS = "http://calendarserver.org/ns/";

    private static final Duration CONNECT_TIMEOUT = Duration.ofSeconds(30);
    private static final Duration REQUEST_TIMEOUT = Duration.ofSeconds(30);

    private final boolean trustAllCertificates;

    CalDavClient(@Value("${caldav.trust-all-certificates:true}") boolean trustAllCertificates) {
        this.trustAllCertificates = trustAllCertificates;
        if (trustAllCertificates) {
            log.warn("CalDAV client is configured to accept all SSL certificates including self-signed. "
                    + "Set caldav.trust-all-certificates=false to enforce certificate validation.");
        }
    }

    /**
     * XML body for a PROPFIND request that discovers calendars and collections.
     */
    private static final String PROPFIND_CALENDARS_XML = """
            <?xml version="1.0" encoding="UTF-8"?>
            <d:propfind xmlns:d="DAV:"
                        xmlns:cs="http://calendarserver.org/ns/"
                        xmlns:c="urn:ietf:params:xml:ns:caldav"
                        xmlns:ic="http://apple.com/ns/ical/">
              <d:prop>
                <d:displayname/>
                <d:resourcetype/>
                <c:calendar-description/>
                <ic:calendar-color/>
                <cs:getctag/>
              </d:prop>
            </d:propfind>
            """;

    /**
     * XML body for a REPORT request that discovers all principals on the server.
     * Uses an empty match element to match all display names (wildcard).
     */
    private static final String PRINCIPAL_SEARCH_XML = """
            <?xml version="1.0" encoding="UTF-8"?>
            <d:principal-property-search xmlns:d="DAV:" test="anyof">
              <d:property-search>
                <d:prop>
                  <d:displayname/>
                </d:prop>
                <d:match/>
              </d:property-search>
              <d:prop>
                <d:displayname/>
                <d:resourcetype/>
              </d:prop>
            </d:principal-property-search>
            """;

    /**
     * Discovers all calendars accessible from the given CalDAV URL.
     * <p>
     * If the URL points directly at a principal's collection (e.g.
     * {@code /caldav.php/username/}), calendars are returned directly.
     * <p>
     * If the URL points at a server root containing principals (e.g.
     * {@code /caldav.php/}), a two-level discovery is performed: first
     * the principals are listed, then each principal is queried for its
     * calendars.
     *
     * @param url      the CalDAV URL
     * @param username the username for authentication
     * @param password the password for authentication
     * @return a list of all discovered calendars
     * @throws CalDavException if the request fails or the response cannot be parsed
     */
    List<CalDavCalendar> discoverCalendars(String url, String username, String password) {
        try {
            var normalizedUrl = normalizeUrl(url);
            var responseBody = sendPropfind(normalizedUrl, username, password);
            var parseResult = parseMultistatusResponse(responseBody, normalizedUrl);

            if (!parseResult.calendars.isEmpty()) {
                // Found calendars directly - URL pointed at a principal's collection
                return parseResult.calendars;
            }

            if (!parseResult.childCollections.isEmpty()) {
                // Found sub-collections but no calendars - likely principals.
                // Query each one for calendars.
                log.debug("No calendars found directly at {}, querying {} sub-collection(s)",
                        normalizedUrl, parseResult.childCollections.size());
                var allCalendars = new ArrayList<CalDavCalendar>();
                for (var collectionHref : parseResult.childCollections) {
                    var collectionUrl = resolveHref(normalizedUrl, collectionHref);
                    try {
                        var childResponse = sendPropfind(collectionUrl, username, password);
                        var childResult = parseMultistatusResponse(childResponse, collectionUrl);
                        allCalendars.addAll(childResult.calendars);
                    } catch (CalDavException e) {
                        log.warn("Failed to query sub-collection {}: {}", collectionUrl, e.getMessage());
                        // Continue with other collections
                    }
                }
                return allCalendars;
            }

            return List.of();
        } catch (CalDavException e) {
            throw e;
        } catch (Exception e) {
            throw new CalDavException("Failed to discover calendars: " + e.getMessage(), e);
        }
    }

    /**
     * Discovers all principals on the server and then queries each one for
     * calendars, including principals whose calendars are not shared with the
     * current user.
     * <p>
     * For principals that the current user cannot access (HTTP 403), a single
     * placeholder calendar entry is created with {@code accessible=false},
     * using the principal's display name.
     * <p>
     * For accessible principals, their calendars are returned with
     * {@code accessible=true} and the principal's display name as the owner.
     *
     * @param url      the CalDAV URL (typically the server root, e.g. {@code /caldav.php/})
     * @param username the username for authentication
     * @param password the password for authentication
     * @return a list of all calendars, including inaccessible ones
     * @throws CalDavException if the principal search fails
     */
    List<CalDavCalendar> discoverAllCalendars(String url, String username, String password) {
        try {
            var normalizedUrl = normalizeUrl(url);
            var principals = discoverPrincipals(normalizedUrl, username, password);

            if (principals.isEmpty()) {
                log.info("No principals found, falling back to standard calendar discovery");
                return discoverCalendars(url, username, password);
            }

            log.info("Found {} principal(s), querying each for calendars", principals.size());
            var allCalendars = new ArrayList<CalDavCalendar>();

            for (var principal : principals) {
                var principalUrl = resolveHref(normalizedUrl, principal.href());
                try {
                    var responseBody = sendPropfind(principalUrl, username, password);
                    var parseResult = parseMultistatusResponse(responseBody, principalUrl);

                    for (var calendar : parseResult.calendars) {
                        allCalendars.add(new CalDavCalendar(
                                calendar.displayName(),
                                calendar.href(),
                                calendar.description(),
                                calendar.color(),
                                calendar.ctag(),
                                principal.displayName(),
                                true
                        ));
                    }
                } catch (CalDavException e) {
                    if (e.getMessage() != null && e.getMessage().contains("Access denied")) {
                        // Principal exists but calendars are not shared with us
                        log.debug("No access to principal {}: {}", principal.displayName(), e.getMessage());
                        allCalendars.add(new CalDavCalendar(
                                principal.displayName(),
                                principal.href(),
                                null,
                                null,
                                null,
                                principal.displayName(),
                                false
                        ));
                    } else {
                        log.warn("Failed to query principal {}: {}", principal.displayName(), e.getMessage());
                    }
                }
            }

            return allCalendars;
        } catch (CalDavException e) {
            throw e;
        } catch (Exception e) {
            throw new CalDavException("Failed to discover all calendars: " + e.getMessage(), e);
        }
    }

    /**
     * Represents a principal (user) discovered on the server.
     *
     * @param displayName the display name of the principal
     * @param href        the href/path of the principal's collection
     */
    record Principal(String displayName, String href) {
    }

    /**
     * Discovers all principals on the CalDAV server using the
     * {@code principal-property-search} REPORT method.
     *
     * @param normalizedUrl the base CalDAV URL
     * @param username      the username for authentication
     * @param password      the password for authentication
     * @return a list of all discovered principals
     */
    List<Principal> discoverPrincipals(String normalizedUrl, String username, String password) {
        try {
            var responseBody = sendReport(normalizedUrl, username, password);
            return parsePrincipalSearchResponse(responseBody);
        } catch (CalDavException e) {
            throw e;
        } catch (Exception e) {
            throw new CalDavException("Failed to discover principals: " + e.getMessage(), e);
        }
    }

    /**
     * Parses a principal-property-search response into a list of principals.
     */
    List<Principal> parsePrincipalSearchResponse(String xml) {
        var principals = new ArrayList<Principal>();
        try {
            var factory = DocumentBuilderFactory.newInstance();
            factory.setNamespaceAware(true);
            var builder = factory.newDocumentBuilder();
            var document = builder.parse(new InputSource(new StringReader(xml)));

            var responses = document.getElementsByTagNameNS(DAV_NS, "response");
            for (int i = 0; i < responses.getLength(); i++) {
                var response = (Element) responses.item(i);
                var href = getTextContent(response, DAV_NS, "href");
                if (href == null) {
                    continue;
                }

                if (!isSuccessResponse(response)) {
                    continue;
                }

                // Only include actual principals (have <principal/> in resourcetype)
                if (!isPrincipalResource(response)) {
                    continue;
                }

                var displayName = getPropertyText(response, DAV_NS, "displayname");
                if (displayName == null || displayName.isBlank()) {
                    displayName = href;
                }

                principals.add(new Principal(displayName, href));
            }
        } catch (Exception e) {
            throw new CalDavException("Failed to parse principal search response: " + e.getMessage(), e);
        }
        return principals;
    }

    private boolean isPrincipalResource(Element response) {
        var propstats = response.getElementsByTagNameNS(DAV_NS, "propstat");
        for (int i = 0; i < propstats.getLength(); i++) {
            var propstat = (Element) propstats.item(i);
            var props = propstat.getElementsByTagNameNS(DAV_NS, "prop");
            for (int j = 0; j < props.getLength(); j++) {
                var prop = (Element) props.item(j);
                var resourceTypes = prop.getElementsByTagNameNS(DAV_NS, "resourcetype");
                for (int k = 0; k < resourceTypes.getLength(); k++) {
                    var resourceType = (Element) resourceTypes.item(k);
                    var principalElements = resourceType.getElementsByTagNameNS(DAV_NS, "principal");
                    if (principalElements.getLength() > 0) {
                        return true;
                    }
                }
            }
        }
        return false;
    }

    private String sendPropfind(String normalizedUrl, String username, String password)
            throws IOException, InterruptedException {
        var credentials = Base64.getEncoder().encodeToString(
                (username + ":" + password).getBytes(StandardCharsets.UTF_8));

        var clientBuilder = HttpClient.newBuilder()
                .connectTimeout(CONNECT_TIMEOUT)
                .followRedirects(HttpClient.Redirect.NORMAL);

        if (trustAllCertificates) {
            clientBuilder.sslContext(createTrustAllSslContext());
        }

        var httpClient = clientBuilder.build();

        var request = HttpRequest.newBuilder()
                .uri(URI.create(normalizedUrl))
                .method("PROPFIND", HttpRequest.BodyPublishers.ofString(PROPFIND_CALENDARS_XML))
                .header("Content-Type", "application/xml; charset=utf-8")
                .header("Depth", "1")
                .header("Authorization", "Basic " + credentials)
                .timeout(REQUEST_TIMEOUT)
                .build();

        log.debug("Sending PROPFIND to {}", normalizedUrl);
        var response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());

        return switch (response.statusCode()) {
            case 207 -> response.body();
            case 401 -> throw new CalDavException("Authentication failed. Please check your username and password.");
            case 403 -> throw new CalDavException("Access denied. You don't have permission to access this calendar.");
            case 404 -> throw new CalDavException("Calendar URL not found. Please check the URL.");
            default -> throw new CalDavException("Server returned unexpected status " + response.statusCode() + ".");
        };
    }

    private String sendReport(String normalizedUrl, String username, String password)
            throws IOException, InterruptedException {
        var credentials = Base64.getEncoder().encodeToString(
                (username + ":" + password).getBytes(StandardCharsets.UTF_8));

        var clientBuilder = HttpClient.newBuilder()
                .connectTimeout(CONNECT_TIMEOUT)
                .followRedirects(HttpClient.Redirect.NORMAL);

        if (trustAllCertificates) {
            clientBuilder.sslContext(createTrustAllSslContext());
        }

        var httpClient = clientBuilder.build();

        var request = HttpRequest.newBuilder()
                .uri(URI.create(normalizedUrl))
                .method("REPORT", HttpRequest.BodyPublishers.ofString(PRINCIPAL_SEARCH_XML))
                .header("Content-Type", "application/xml; charset=utf-8")
                .header("Depth", "0")
                .header("Authorization", "Basic " + credentials)
                .timeout(REQUEST_TIMEOUT)
                .build();

        log.debug("Sending REPORT principal-property-search to {}", normalizedUrl);
        var response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());

        return switch (response.statusCode()) {
            case 207 -> response.body();
            case 401 -> throw new CalDavException("Authentication failed. Please check your username and password.");
            case 403 -> throw new CalDavException("Access denied. You don't have permission to search principals.");
            case 404 -> throw new CalDavException("URL not found. Please check the URL.");
            default -> throw new CalDavException("Server returned unexpected status " + response.statusCode() + ".");
        };
    }

    /**
     * Result of parsing a PROPFIND multistatus response. Contains both
     * discovered calendars and non-calendar child collections (principals).
     */
    record PropfindResult(List<CalDavCalendar> calendars, List<String> childCollections) {
    }

    PropfindResult parseMultistatusResponse(String xml, String requestUrl) {
        var calendars = new ArrayList<CalDavCalendar>();
        var childCollections = new ArrayList<String>();
        try {
            var factory = DocumentBuilderFactory.newInstance();
            factory.setNamespaceAware(true);
            var builder = factory.newDocumentBuilder();
            var document = builder.parse(new InputSource(new StringReader(xml)));

            var responses = document.getElementsByTagNameNS(DAV_NS, "response");
            for (int i = 0; i < responses.getLength(); i++) {
                var response = (Element) responses.item(i);
                var href = getTextContent(response, DAV_NS, "href");
                if (href == null) {
                    continue;
                }

                // Skip the response for the collection itself
                if (isSameResource(href, requestUrl)) {
                    continue;
                }

                // Only process successful responses
                if (!isSuccessResponse(response)) {
                    continue;
                }

                if (isCalendarResource(response)) {
                    var calendar = parseCalendarFromResponse(response, href);
                    if (calendar != null) {
                        calendars.add(calendar);
                    }
                } else if (isCollectionResource(response)) {
                    childCollections.add(href);
                }
            }
        } catch (CalDavException e) {
            throw e;
        } catch (Exception e) {
            throw new CalDavException("Failed to parse server response: " + e.getMessage(), e);
        }
        return new PropfindResult(calendars, childCollections);
    }

    private @Nullable CalDavCalendar parseCalendarFromResponse(Element response, String href) {
        var displayName = getPropertyText(response, DAV_NS, "displayname");
        var description = getPropertyText(response, CALDAV_NS, "calendar-description");
        var color = getPropertyText(response, APPLE_ICAL_NS, "calendar-color");
        var ctag = getPropertyText(response, CALENDARSERVER_NS, "getctag");

        // Use href as display name fallback
        if (displayName == null || displayName.isBlank()) {
            displayName = href;
        }

        // Normalize color to 7-char hex if it has alpha channel (#RRGGBBAA -> #RRGGBB)
        if (color != null && color.length() == 9 && color.startsWith("#")) {
            color = color.substring(0, 7);
        }

        return new CalDavCalendar(displayName, href, description, color, ctag, null, true);
    }

    private boolean isCalendarResource(Element response) {
        var propstats = response.getElementsByTagNameNS(DAV_NS, "propstat");
        for (int i = 0; i < propstats.getLength(); i++) {
            var propstat = (Element) propstats.item(i);
            var props = propstat.getElementsByTagNameNS(DAV_NS, "prop");
            for (int j = 0; j < props.getLength(); j++) {
                var prop = (Element) props.item(j);
                var resourceTypes = prop.getElementsByTagNameNS(DAV_NS, "resourcetype");
                for (int k = 0; k < resourceTypes.getLength(); k++) {
                    var resourceType = (Element) resourceTypes.item(k);
                    var calendarElements = resourceType.getElementsByTagNameNS(CALDAV_NS, "calendar");
                    if (calendarElements.getLength() > 0) {
                        return true;
                    }
                }
            }
        }
        return false;
    }

    private boolean isCollectionResource(Element response) {
        var propstats = response.getElementsByTagNameNS(DAV_NS, "propstat");
        for (int i = 0; i < propstats.getLength(); i++) {
            var propstat = (Element) propstats.item(i);
            var props = propstat.getElementsByTagNameNS(DAV_NS, "prop");
            for (int j = 0; j < props.getLength(); j++) {
                var prop = (Element) props.item(j);
                var resourceTypes = prop.getElementsByTagNameNS(DAV_NS, "resourcetype");
                for (int k = 0; k < resourceTypes.getLength(); k++) {
                    var resourceType = (Element) resourceTypes.item(k);
                    var collectionElements = resourceType.getElementsByTagNameNS(DAV_NS, "collection");
                    if (collectionElements.getLength() > 0) {
                        return true;
                    }
                }
            }
        }
        return false;
    }

    private boolean isSuccessResponse(Element response) {
        var propstats = response.getElementsByTagNameNS(DAV_NS, "propstat");
        for (int i = 0; i < propstats.getLength(); i++) {
            var propstat = (Element) propstats.item(i);
            var statusText = getTextContent(propstat, DAV_NS, "status");
            if (statusText != null && statusText.contains("200")) {
                return true;
            }
        }
        return false;
    }

    private @Nullable String getPropertyText(Element response, String namespace, String localName) {
        var propstats = response.getElementsByTagNameNS(DAV_NS, "propstat");
        for (int i = 0; i < propstats.getLength(); i++) {
            var propstat = (Element) propstats.item(i);
            var props = propstat.getElementsByTagNameNS(DAV_NS, "prop");
            for (int j = 0; j < props.getLength(); j++) {
                var prop = (Element) props.item(j);
                var elements = prop.getElementsByTagNameNS(namespace, localName);
                if (elements.getLength() > 0) {
                    var text = elements.item(0).getTextContent();
                    return (text != null && !text.isBlank()) ? text.strip() : null;
                }
            }
        }
        return null;
    }

    private @Nullable String getTextContent(Element parent, String namespace, String localName) {
        var elements = parent.getElementsByTagNameNS(namespace, localName);
        if (elements.getLength() > 0) {
            return elements.item(0).getTextContent();
        }
        return null;
    }

    private boolean isSameResource(String href, String requestUrl) {
        var normalizedHref = href.replaceAll("/+$", "");
        var normalizedUrl = requestUrl.replaceAll("/+$", "");

        if (normalizedUrl.endsWith(normalizedHref)) {
            return true;
        }

        try {
            var hrefPath = URI.create(normalizedHref).getPath();
            var urlPath = URI.create(normalizedUrl).getPath();
            if (hrefPath != null && urlPath != null) {
                return hrefPath.replaceAll("/+$", "").equals(urlPath.replaceAll("/+$", ""));
            }
        } catch (IllegalArgumentException e) {
            // If we can't parse, fall through to simple comparison
        }
        return normalizedHref.equals(normalizedUrl);
    }

    /**
     * Resolves an href (which may be relative) against the request URL
     * to produce an absolute URL.
     */
    private String resolveHref(String baseUrl, String href) {
        if (href.startsWith("http://") || href.startsWith("https://")) {
            return normalizeUrl(href);
        }
        // href is a path like /caldav.php/username/ - combine with base URL's scheme+host
        var baseUri = URI.create(baseUrl);
        var resolved = baseUri.resolve(href).toString();
        return normalizeUrl(resolved);
    }

    String normalizeUrl(String url) {
        var normalized = url.strip();
        if (!normalized.endsWith("/")) {
            normalized += "/";
        }
        if (!normalized.startsWith("http://") && !normalized.startsWith("https://")) {
            normalized = "https://" + normalized;
        }
        return normalized;
    }

    /**
     * Creates an {@link SSLContext} that trusts all certificates, including self-signed ones.
     */
    private SSLContext createTrustAllSslContext() {
        try {
            var trustAllManager = new X509TrustManager() {
                @Override
                public void checkClientTrusted(X509Certificate[] chain, String authType) {
                    // Trust all client certificates
                }

                @Override
                public void checkServerTrusted(X509Certificate[] chain, String authType) {
                    // Trust all server certificates
                }

                @Override
                public X509Certificate[] getAcceptedIssuers() {
                    return new X509Certificate[0];
                }
            };

            var sslContext = SSLContext.getInstance("TLS");
            sslContext.init(null, new TrustManager[]{trustAllManager}, null);
            return sslContext;
        } catch (NoSuchAlgorithmException | KeyManagementException e) {
            throw new CalDavException("Failed to create SSL context for trusting all certificates.", e);
        }
    }
}
