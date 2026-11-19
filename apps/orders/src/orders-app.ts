// Placeholder library entry; replaced by the real custom element in a later task.
// `?inline` bundles the CSS text into the JS module (for adoption into the shadow root).
import styles from "./styles.css?inline";

export { styles };

if (!customElements.get('orders-app')) {
  customElements.define('orders-app', class extends HTMLElement {});
}
