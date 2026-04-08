/**
 * About / Copyright dialog with placeholder content.
 */

export interface AboutDialogProps {
  open: boolean;
  onClose: () => void;
}

export function AboutDialog({ open, onClose }: AboutDialogProps) {
  if (!open) return null;

  return (
    <div class="login-overlay" onClick={onClose}>
      <div
        class="login-dialog about-dialog"
        onClick={(e) => e.stopPropagation()}
      >
        <div class="login-dialog-header">
          <h2>Info</h2>
        </div>
        <div class="login-dialog-body about-dialog-body">
          <div class="about-app-title">
            <strong>CalView &ndash; Terminplaner</strong>
          </div>
          <div class="about-version">Version 1.0.0</div>

          <section>
            <h3>Copyright</h3>
            <p class="about-placeholder">
              &copy; 2025 &ndash; [Copyright-Inhaber hier einf&uuml;gen]
            </p>
          </section>

          <section>
            <h3>Urheberhinweise</h3>
            <p class="about-placeholder">
              [Urheberhinweise und Lizenzen hier einf&uuml;gen]
            </p>
          </section>

          <section>
            <h3>Drittanbieter-Lizenzen</h3>
            <p class="about-placeholder">
              [Drittanbieter-Lizenzen hier einf&uuml;gen]
            </p>
          </section>

          <section>
            <h3>Kontakt</h3>
            <p class="about-placeholder">
              [Kontaktinformationen hier einf&uuml;gen]
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
