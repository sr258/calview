/**
 * About / Copyright dialog showing app info and third-party licenses.
 * License texts are loaded on demand from a separate JSON asset.
 */

import { useState, useCallback } from "preact/hooks";
import licenses from "virtual:licenses";

const EUPL_TEXT = `OPEN-SOURCE-LIZENZ FÜR DIE EUROPÄISCHE UNION v. 1.2
EUPL © Europäische Union 2007, 2016

Diese Open-Source-Lizenz für die Europäische Union („EUPL") gilt für Werke (im
Sinne der nachfolgenden Begriffsbestimmung), die unter EUPL-Bedingungen zur
Verfügung gestellt werden. Das Werk darf nur in der durch diese Lizenz
gestatteten Form genutzt werden (insoweit eine solche Nutzung dem Urheber
vorbehalten ist).

Das Werk wird unter den Bedingungen dieser Lizenz zur Verfügung gestellt, wenn
der Lizenzgeber (im Sinne der nachfolgenden Begriffsbestimmung) den folgenden
Hinweis unmittelbar hinter dem Urheberrechtshinweis dieses Werks anbringt:
„Lizenziert unter der EUPL" oder in einer anderen Form zum Ausdruck bringt,
dass er es unter der EUPL lizenzieren möchte.

1. Begriffsbestimmungen

Für diese Lizenz gelten folgende Begriffsbestimmungen:

— „Lizenz": diese Lizenz.
— „Originalwerk": das Werk oder die Software, die vom Lizenzgeber unter dieser
  Lizenz verbreitet oder zugänglich gemacht wird, und zwar als Quellcode und
  gegebenenfalls auch als ausführbarer Code.
— „Bearbeitungen": die Werke oder Software, die der Lizenznehmer auf der
  Grundlage des Originalwerks oder seiner Bearbeitungen schaffen kann. In dieser
  Lizenz wird nicht festgelegt, wie umfangreich die Änderung oder wie stark die
  Abhängigkeit vom Originalwerk für eine Einstufung als Bearbeitung sein muss;
  dies bestimmt sich nach dem Urheberrecht, das in dem unter Artikel 15
  aufgeführten Land anwendbar ist.
— „Werk": das Originalwerk oder seine Bearbeitungen.
— „Quellcode": diejenige Form des Werkes, die zur Auffassung durch den Menschen
  bestimmt ist und die am besten geeignet ist, um vom Menschen verstanden und
  verändert zu werden.
— „Ausführbarer Code": die — üblicherweise — kompilierte Form des Werks, die
  von einem Computer als Programm ausgeführt werden soll.
— „Lizenzgeber": die natürliche oder juristische Person, die das Werk unter der
  Lizenz verbreitet oder zugänglich macht.
— „Bearbeiter": jede natürliche oder juristische Person, die das Werk unter der
  Lizenz verändert oder auf andere Weise zur Schaffung einer Bearbeitung
  beiträgt.
— „Lizenznehmer" („Sie"): jede natürliche oder juristische Person, die das Werk
  unter den Lizenzbedingungen nutzt.
— „Verbreitung" oder „Zugänglichmachung": alle Formen von Verkauf, Überlassung,
  Verleih, Vermietung, Verbreitung, Weitergabe, Übermittlung oder anderweitiger
  Online- oder Offline-Bereitstellung von Vervielfältigungen des Werks oder
  Zugänglichmachung seiner wesentlichen Funktionen für dritte natürliche oder
  juristische Personen.

2. Umfang der Lizenzrechte

Der Lizenzgeber erteilt Ihnen hiermit für die Gültigkeitsdauer der am
Originalwerk bestehenden Urheberrechte eine weltweite, unentgeltliche, nicht
ausschließliche, unterlizenzierbare Lizenz, die Sie berechtigt:

— das Werk uneingeschränkt zu nutzen,
— das Werk zu vervielfältigen,
— das Werk zu verändern und Bearbeitungen auf der Grundlage des Werks zu
  schaffen,
— das Werk öffentlich zugänglich zu machen, was das Recht einschließt, das Werk
  oder Vervielfältigungsstücke davon öffentlich bereitzustellen oder wahrnehmbar
  zu machen oder das Werk, soweit möglich, öffentlich aufzuführen,
— das Werk oder Vervielfältigungen davon zu verbreiten,
— das Werk oder Vervielfältigungen davon zu vermieten oder zu verleihen,
— das Werk oder Vervielfältigungen davon weiter zu lizenzieren.

Für die Wahrnehmung dieser Rechte können beliebige, derzeit bekannte oder
künftige Medien, Träger und Formate verwendet werden, soweit das geltende Recht
dem nicht entgegensteht.

Für die Länder, in denen Urheberpersönlichkeitsrechte an dem Werk bestehen,
verzichtet der Lizenzgeber im gesetzlich zulässigen Umfang auf seine
Urheberpersönlichkeitsrechte, um die Lizenzierung der oben aufgeführten
Verwertungsrechte wirksam durchführen zu können.

Der Lizenzgeber erteilt dem Lizenznehmer ein nicht ausschließliches,
unentgeltliches Nutzungsrecht an seinen Patenten, sofern dies zur Ausübung der
durch die Lizenz erteilten Nutzungsrechte am Werk notwendig ist.

3. Zugänglichmachung des Quellcodes

Der Lizenzgeber kann das Werk entweder als Quellcode oder als ausführbaren Code
zur Verfügung stellen. Stellt er es als ausführbaren Code zur Verfügung, so
stellt er darüber hinaus eine maschinenlesbare Kopie des Quellcodes für jedes
von ihm verbreitete Vervielfältigungsstück des Werks zur Verfügung, oder er
verweist in einem Vermerk im Anschluss an den dem Werk beigefügten
Urheberrechtshinweis auf einen Speicherort, an dem problemlos und unentgeltlich
auf den Quellcode zugegriffen werden kann, solange der Lizenzgeber das Werk
verbreitet oder zugänglich macht.

4. Einschränkungen des Urheberrechts

Es ist nicht Zweck dieser Lizenz, Ausnahmen oder Schranken der ausschließlichen
Rechte des Urhebers am Werk, die dem Lizenznehmer zugutekommen, einzuschränken.
Auch die Erschöpfung dieser Rechte bleibt von dieser Lizenz unberührt.

5. Pflichten des Lizenznehmers

Die Einräumung der oben genannten Rechte ist an mehrere Beschränkungen und
Pflichten für den Lizenznehmer gebunden:

Urheberrechtshinweis, Lizenztext, Nennung des Bearbeiters: Der Lizenznehmer muss
alle Urheberrechts-, Patent- oder Markenrechtshinweise und alle Hinweise auf die
Lizenz und den Haftungsausschluss unverändert lassen. Jedem von ihm verbreiteten
oder zugänglich gemachten Vervielfältigungsstück des Werks muss der Lizenznehmer
diese Hinweise sowie diese Lizenz beifügen. Der Lizenznehmer muss auf jedem
abgeleiteten Werk deutlich darauf hinweisen, dass das Werk geändert wurde, und
das Datum der Bearbeitung angeben.

„Copyleft"-Klausel: Der Lizenznehmer darf Vervielfältigungen des Originalwerks
oder Bearbeitungen nur unter den Bedingungen dieser EUPL oder einer neueren
Version dieser Lizenz verbreiten oder zugänglich machen, außer wenn das
Originalwerk ausdrücklich nur unter dieser Lizenzversion — z. B. mit der Angabe
„Nur EUPL V. 1.2" — verbreitet werden darf. Der Lizenznehmer (der zum
Lizenzgeber wird) darf für das Werk oder die Bearbeitung keine zusätzlichen
Bedingungen anbieten oder vorschreiben, die die Bedingungen dieser Lizenz
verändern oder einschränken.

Kompatibilitäts-Klausel: Wenn der Lizenznehmer Bearbeitungen, die auf dem Werk
und einem anderen Werk, das unter einer kompatiblen Lizenz lizenziert wurde,
basieren, oder die Kopien dieser Bearbeitungen verbreitet oder zugänglich macht,
kann dies unter den Bedingungen dieser kompatiblen Lizenz erfolgen. Unter
„kompatibler Lizenz" ist eine im Anhang dieser Lizenz angeführte Lizenz zu
verstehen. Sollten die Verpflichtungen des Lizenznehmers aus der kompatiblen
Lizenz mit denjenigen aus der vorliegenden Lizenz (EUPL) in Konflikt stehen,
werden die Verpflichtungen aus der kompatiblen Lizenz Vorrang haben.

Bereitstellung des Quellcodes: Wenn der Lizenznehmer Vervielfältigungsstücke des
Werks verbreitet oder zugänglich macht, muss er eine maschinenlesbare Fassung
des Quellcodes mitliefern oder einen Speicherort angeben, über den problemlos
und unentgeltlich so lange auf diesen Quellcode zugegriffen werden kann, wie der
Lizenznehmer das Werk verbreitet oder zugänglich macht.

Rechtsschutz: Diese Lizenz erlaubt nicht die Benutzung von Kennzeichen, Marken
oder geschützten Namensrechten des Lizenzgebers, soweit dies nicht für die
angemessene und übliche Beschreibung der Herkunft des Werks und der inhaltlichen
Wiedergabe des Urheberrechtshinweises erforderlich ist.

6. Urheber und Bearbeiter

Der ursprüngliche Lizenzgeber gewährleistet, dass er das Urheberrecht am
Originalwerk innehat oder dieses an ihn lizenziert wurde und dass er befugt ist,
diese Lizenz zu erteilen.

Jeder Bearbeiter gewährleistet, dass er das Urheberrecht an den von ihm
vorgenommenen Änderungen des Werks besitzt und befugt ist, diese Lizenz zu
erteilen.

Jedes Mal, wenn Sie die Lizenz annehmen, erteilen Ihnen der ursprüngliche
Lizenzgeber und alle folgenden Bearbeiter eine Befugnis zur Nutzung ihrer
Beiträge zum Werk unter den Bedingungen dieser Lizenz.

7. Gewährleistungsausschluss

Die Arbeit an diesem Werk wird laufend fortgeführt; es wird durch unzählige
Bearbeiter ständig verbessert. Das Werk ist nicht vollendet und kann daher
Fehler („bugs") enthalten, die dieser Art der Entwicklung inhärent sind.

Aus den genannten Gründen wird das Werk unter dieser Lizenz „so, wie es ist"
ohne jegliche Gewährleistung zur Verfügung gestellt. Dies gilt unter anderem —
aber nicht ausschließlich — für Marktreife, Verwendbarkeit für einen bestimmten
Zweck, Mängelfreiheit, Richtigkeit sowie Nichtverletzung von anderen
Immaterialgüterrechten als dem Urheberrecht (vgl. dazu Artikel 6 dieser Lizenz).

Dieser Gewährleistungsausschluss ist wesentlicher Bestandteil der Lizenz und
Bedingung für die Einräumung von Rechten an dem Werk.

8. Haftungsausschluss/Haftungsbeschränkung

Außer in Fällen von Vorsatz oder der Verursachung von Personenschäden haftet der
Lizenzgeber nicht für direkte oder indirekte, materielle oder immaterielle
Schäden irgendwelcher Art, die aus der Lizenz oder der Benutzung des Werks
folgen; dies gilt unter anderem, aber nicht ausschließlich, für
Firmenwertverluste, Produktionsausfall, Computerausfall oder Computerfehler,
Datenverlust oder wirtschaftliche Schäden, und zwar auch dann, wenn der
Lizenzgeber auf die Möglichkeit solcher Schäden hingewiesen wurde. Unabhängig
davon haftet der Lizenzgeber im Rahmen der gesetzlichen Produkthaftung, soweit
die entsprechenden Regelungen auf das Werk anwendbar sind.

9. Zusatzvereinbarungen

Wenn Sie das Werk verbreiten, können Sie Zusatzvereinbarungen schließen, in
denen Verpflichtungen oder Dienstleistungen festgelegt werden, die mit dieser
Lizenz vereinbar sind. Sie dürfen Verpflichtungen indessen nur in Ihrem eigenen
Namen und auf Ihre eigene Verantwortung eingehen, nicht jedoch im Namen des
ursprünglichen Lizenzgebers oder eines anderen Bearbeiters, und nur, wenn Sie
sich gegenüber allen Bearbeitern verpflichten, sie zu entschädigen, zu
verteidigen und von der Haftung freizustellen, falls aufgrund der von Ihnen
eingegangenen Gewährleistungsverpflichtung oder Haftungsübernahme Forderungen
gegen sie geltend gemacht werden oder eine Haftungsverpflichtung entsteht.

10. Annahme der Lizenz

Sie können den Bestimmungen dieser Lizenz zustimmen, indem Sie das Symbol
„Lizenz annehmen" unter dem Fenster mit dem Lizenztext anklicken oder indem Sie
Ihre Zustimmung auf vergleichbare Weise in einer nach anwendbarem Recht
zulässigen Form geben. Das Anklicken des Symbols gilt als Anzeichen Ihrer
eindeutigen und unwiderruflichen Annahme der Lizenz und der darin enthaltenen
Klauseln und Bedingungen.

In gleicher Weise gilt als Zeichen der eindeutigen und unwiderruflichen
Zustimmung die Ausübung eines Rechtes, das in Artikel 2 dieser Lizenz angeführt
ist, wie das Erstellen einer Bearbeitung oder die Verbreitung oder
Zugänglichmachung des Werks oder dessen Vervielfältigungen.

11. Informationspflichten

Wenn Sie das Werk verbreiten oder zugänglich machen (beispielsweise, indem Sie
es zum Herunterladen von einer Website anbieten), müssen Sie über den
Vertriebskanal oder das benutzte Verbreitungsmedium der Öffentlichkeit zumindest
jene Informationen bereitstellen, die nach dem anwendbaren Recht bezüglich der
Lizenzgeber, der Lizenz und ihrer Zugänglichkeit, des Abschlusses des
Lizenzvertrags sowie darüber, wie die Lizenz durch den Lizenznehmer gespeichert
und vervielfältigt werden kann, erforderlich sind.

12. Beendigung der Lizenz

Die Lizenz und die damit eingeräumten Rechte erlöschen automatisch, wenn der
Lizenznehmer gegen die Lizenzbedingungen verstößt.

Ein solches Erlöschen der Lizenz führt nicht zum Erlöschen der Lizenzen von
Personen, denen das Werk vom Lizenznehmer unter dieser Lizenz zur Verfügung
gestellt worden ist, solange diese Personen die Lizenzbedingungen erfüllen.

13. Sonstiges

Unbeschadet des Artikels 9 stellt die Lizenz die vollständige Vereinbarung der
Parteien über das Werk dar.

Sind einzelne Bestimmungen der Lizenz nach geltendem Recht nichtig oder
unwirksam, so berührt dies nicht die Wirksamkeit oder Durchsetzbarkeit der
Lizenz an sich. Solche Bestimmungen werden vielmehr so ausgelegt oder
modifiziert, dass sie wirksam und durchsetzbar sind.

Die Europäische Kommission kann weitere Sprachfassungen oder neue Versionen
dieser Lizenz oder aktualisierte Fassungen des Anhangs veröffentlichen, soweit
dies notwendig und angemessen ist, ohne den Umfang der Lizenzrechte zu
verringern. Neue Versionen werden mit einer eindeutigen Versionsnummer
veröffentlicht.

Alle von der Europäischen Kommission anerkannten Sprachfassungen dieser Lizenz
sind gleichwertig. Die Parteien können sich auf die Sprachfassung ihrer Wahl
berufen.

14. Gerichtsstand

Unbeschadet besonderer Vereinbarungen zwischen den Parteien gilt Folgendes:

— Für alle Streitigkeiten über die Auslegung dieser Lizenz zwischen den Organen,
  Einrichtungen und sonstigen Stellen der Europäischen Union als Lizenzgeber und
  einem Lizenznehmer ist der Gerichtshof der Europäischen Union gemäß Artikel
  272 des Vertrags über die Arbeitsweise der Europäischen Union zuständig;

— Gerichtsstand für Streitigkeiten zwischen anderen Parteien über die Auslegung
  dieser Lizenz ist allein der Ort, an dem der Lizenzgeber seinen Wohnsitz oder
  den wirtschaftlichen Mittelpunkt seiner Tätigkeit hat.

15. Anwendbares Recht

Unbeschadet besonderer Vereinbarungen zwischen den Parteien gilt Folgendes:

— Diese Lizenz unterliegt dem Recht des Mitgliedstaats der Europäischen Union,
  in dem der Lizenzgeber seinen Sitz, Wohnsitz oder eingetragenen Sitz hat;

— diese Lizenz unterliegt dem belgischen Recht, wenn der Lizenzgeber keinen
  Sitz, Wohnsitz oder eingetragenen Sitz in einem Mitgliedstaat der Europäischen
  Union hat.

Anlage

„Kompatible Lizenzen" nach Artikel 5 der EUPL sind:

— GNU General Public License (GPL) v. 2, v. 3
— GNU Affero General Public License (AGPL) v. 3
— Open Software License (OSL) v. 2.1, v. 3.0
— Eclipse Public License (EPL) v. 1.0
— CeCILL v. 2.0, v. 2.1
— Mozilla Public Licence (MPL) v. 2
— GNU Lesser General Public Licence (LGPL) v. 2.1, v. 3
— Creative Commons Attribution-ShareAlike v. 3.0 Unported (CC BY-SA 3.0) für
  andere Werke als Software
— European Union Public Licence (EUPL) v. 1.1, v. 1.2
— Québec Free and Open-Source Licence — Reciprocity (LiLiQ-R) oder Strong
  Reciprocity (LiLiQ-R+)

Die Europäische Kommission kann diesen Anhang aktualisieren, um neuere Fassungen
der obigen Lizenzen aufzunehmen, ohne hierfür eine neue Fassung der EUPL
auszuarbeiten, solange diese Lizenzen die in Artikel 2 gewährten Rechte
gewährleisten und den erfassten Quellcode vor ausschließlicher Aneignung
schützen.

Alle sonstigen Änderungen oder Ergänzungen dieses Anhangs bedürfen der
Ausarbeitung einer neuen Version der EUPL.`;

export interface AboutDialogProps {
  open: boolean;
  onClose: () => void;
}

/** Cache for the license texts JSON (fetched once). */
let textsCache: Record<string, string> | null = null;
let textsPromise: Promise<Record<string, string>> | null = null;

function fetchLicenseTexts(): Promise<Record<string, string>> {
  if (textsCache) return Promise.resolve(textsCache);
  if (!textsPromise) {
    textsPromise = fetch("/license-texts.json")
      .then((r) => r.json())
      .then((data: Record<string, string>) => {
        textsCache = data;
        return data;
      })
      .catch(() => {
        textsPromise = null;
        return {} as Record<string, string>;
      });
  }
  return textsPromise;
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
            <h3>Lizenz</h3>
            <p class="about-placeholder">
              &copy; 2026 Sebastian Rettig
              <br />
              Lizenziert unter der EUPL v1.2
            </p>
            <div class="license-list" style="margin-top: var(--cv-space-xs)">
              <details class="license-entry">
                <summary>
                  <span class="license-name">Lizenztext anzeigen</span>
                  <span class="license-spacer" />
                  <span class="license-id">EUPL-1.2</span>
                </summary>
                <pre class="license-text">{EUPL_TEXT}</pre>
              </details>
            </div>
          </section>

          <section>
            <h3>Kontakt</h3>
            <p class="about-placeholder">
              Sebastian Rettig &ndash;{" "}
              <a href="mailto:serettig@posteo.de">serettig@posteo.de</a>
              <br />
              <a href="https://github.com/sr258/calview" target="_blank" rel="noopener noreferrer">
                github.com/sr258/calview
              </a>
            </p>
          </section>

          {licenses.length > 0 && (
            <section>
              <h3>Drittanbieter-Lizenzen</h3>
              <div class="license-list">
                {licenses.map((dep) => (
                  <LicenseItem key={dep.name} dep={dep} />
                ))}
              </div>
            </section>
          )}
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

interface LicenseItemProps {
  dep: { name: string; license: string; url?: string };
}

function LicenseItem({ dep }: LicenseItemProps) {
  const [text, setText] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const onToggle = useCallback(
    (e: Event) => {
      const details = e.currentTarget as HTMLDetailsElement;
      if (details.open && text === null && !loading) {
        setLoading(true);
        fetchLicenseTexts().then((texts) => {
          setText(texts[dep.name] ?? "");
          setLoading(false);
        });
      }
    },
    [dep.name, text, loading],
  );

  return (
    <details class="license-entry" onToggle={onToggle}>
      <summary>
        <span class="license-name">{dep.name}</span>
        <span class="license-spacer" />
        <span class="license-id">{dep.license}</span>
        {dep.url && (
          <a
            class="license-link"
            href={dep.url}
            target="_blank"
            rel="noopener noreferrer"
            title="Quellcode"
            onClick={(e) => e.stopPropagation()}
          >
            <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true">
              <path d="M3.75 2h3.5a.75.75 0 010 1.5H4.5v8h8V8.75a.75.75 0 011.5 0v3.5A1.75 1.75 0 0112.25 14h-8.5A1.75 1.75 0 012 12.25v-8.5C2 2.784 2.784 2 3.75 2zm6.5 0h3a.75.75 0 01.75.75v3a.75.75 0 01-1.5 0V4.06L8.28 8.28a.75.75 0 01-1.06-1.06L11.44 3H9.75a.75.75 0 010-1.5h.5z" />
            </svg>
          </a>
        )}
      </summary>
      {loading && <p class="license-text license-text-missing">Laden…</p>}
      {!loading && text !== null && text.length > 0 && (
        <pre class="license-text">{text}</pre>
      )}
      {!loading && text !== null && text.length === 0 && (
        <p class="license-text license-text-missing">
          Lizenztext nicht verf&uuml;gbar.
        </p>
      )}
    </details>
  );
}
