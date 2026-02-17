import { bus } from '../utils/EventBus.js';

export class Toast {
  constructor() {
    this.el = document.createElement('div');
    this.el.className = 'toast hidden';
    document.body.appendChild(this.el);
    this._timer = null;
    bus.on('toast', payload => this.show(payload));
  }

  show(payload) {
    const data = payload || {};
    this.el.textContent = data.message || '';
    this.el.classList.remove('hidden');
    clearTimeout(this._timer);
    const duration = data.duration || 1600;
    this._timer = setTimeout(() => this.hide(), duration);
  }

  hide() {
    this.el.classList.add('hidden');
  }
}
