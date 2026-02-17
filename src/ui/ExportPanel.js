import { bus } from '../utils/EventBus.js';
import { store } from '../data/Store.js';
import { exportExhibition } from '../utils/JsonExporter.js';

export class ExportPanel {
  constructor() {
    this.overlay = document.createElement('div');
    this.overlay.className = 'export-overlay hidden';
    this.overlay.innerHTML = `
      <div class="export-modal">
        <div class="export-header">
          <span>导出 JSON</span>
          <button class="btn-icon export-close">&times;</button>
        </div>
        <pre class="export-preview" id="export-preview"></pre>
        <button class="btn-accent" id="download-json">下载 .json 文件</button>
      </div>
    `;
    document.body.appendChild(this.overlay);
    this._bind();
    bus.on('export-requested', () => this.show());
  }

  show() {
    const data = exportExhibition(store);
    const json = JSON.stringify(data, null, 2);
    this.overlay.querySelector('#export-preview').textContent = json;
    this.overlay.classList.remove('hidden');
    this._json = json;
    this._name = store.exhibition?.name || 'exhibition';
  }

  hide() { this.overlay.classList.add('hidden'); }

  _bind() {
    this.overlay.addEventListener('click', e => {
      if (e.target.classList.contains('export-overlay') ||
          e.target.classList.contains('export-close')) {
        this.hide();
      }
      if (e.target.id === 'download-json') {
        const blob = new Blob([this._json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${this._name.replace(/\s+/g, '_')}.json`;
        a.click();
        URL.revokeObjectURL(url);
      }
    });
  }
}
