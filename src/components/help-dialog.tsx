/**
 * Help dialog explaining how the application works.
 */

export interface HelpDialogProps {
  open: boolean;
  onClose: () => void;
}

export function HelpDialog({ open, onClose }: HelpDialogProps) {
  if (!open) return null;

  return (
    <div class="login-overlay" onClick={onClose}>
      <div
        class="login-dialog help-dialog"
        onClick={(e) => e.stopPropagation()}
      >
        <div class="login-dialog-header">
          <h2>Hilfe</h2>
        </div>
        <div class="login-dialog-body help-dialog-body">
          <section>
            <h3>Was ist CalView?</h3>
            <p>
              CalView ist ein Terminplaner, der Ihnen hilft, gemeinsame freie
              Zeitfenster f&uuml;r Besprechungen zu finden. Die Anwendung
              verbindet sich mit einem CalDAV-Server und zeigt die
              Verf&uuml;gbarkeit mehrerer Personen in einer Wochen&uuml;bersicht
              an.
            </p>
          </section>

          <section>
            <h3>Erste Schritte</h3>
            <ol>
              <li>
                Klicken Sie auf <strong>Verbinden</strong> und geben Sie Ihre
                Zugangsdaten ein.
              </li>
              <li>
                Suchen Sie im Suchfeld nach Benutzern (mindestens 2 Zeichen).
              </li>
              <li>
                Klicken Sie auf einen Benutzer, um ihn zur Ansicht
                hinzuzuf&uuml;gen.
              </li>
              <li>
                Die Wochenansicht zeigt nun die Termine aller ausgew&auml;hlten
                Personen.
              </li>
            </ol>
          </section>

          <section>
            <h3>Farben in der Tabellen-Ansicht</h3>
            <div class="help-color-legend">
              <div class="help-color-item">
                <span class="help-swatch slot-busy" />
                <span>Belegt (mit Termindetails)</span>
              </div>
              <div class="help-color-item">
                <span class="help-swatch slot-busy-fb" />
                <span>Belegt (nur Frei/Belegt-Info)</span>
              </div>
              <div class="help-color-item">
                <span class="help-swatch slot-busy-tentative" />
                <span>Vorl&auml;ufig belegt</span>
              </div>
              <div class="help-color-item">
                <span class="help-swatch slot-busy-unavailable" />
                <span>Nicht verf&uuml;gbar</span>
              </div>
              <div class="help-color-item">
                <span class="help-swatch slot-all-free" />
                <span>Alle frei</span>
              </div>
            </div>
          </section>

          <section>
            <h3>Termin erstellen</h3>
            <p>
              Klicken Sie auf eine Zeitzeile in der Tabellen- oder
              Kalender-Ansicht, um einen Outlook-Termin mit allen
              ausgew&auml;hlten Personen als Teilnehmer zu erstellen.
            </p>
          </section>

          <section>
            <h3>Favoriten</h3>
            <p>
              Markieren Sie h&auml;ufig verwendete Benutzer mit dem
              Stern-Symbol als Favoriten. Favoriten werden gespeichert und
              k&ouml;nnen sp&auml;ter schnell wieder hinzugef&uuml;gt werden.
            </p>
          </section>

          <section>
            <h3>Navigation</h3>
            <p>
              Verwenden Sie die Pfeiltasten oder die Schaltfl&auml;chen
              &laquo;Zur&uuml;ck&raquo; und &laquo;Weiter&raquo;, um
              zwischen den Wochen zu wechseln. Mit &laquo;Heute&raquo; kehren
              Sie zur aktuellen Woche zur&uuml;ck.
            </p>
          </section>
        </div>
        <div class="login-dialog-footer">
          <button class="btn btn-primary" onClick={onClose}>
            Schlie&szlig;en
          </button>
        </div>
      </div>
    </div>
  );
}
