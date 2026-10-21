/**
 * ENTROPIA BRIDGE v2.0
 * Універсальний комунікаційний міст між модулями екосистеми:
 * Лист Персонажів <-> Інтерактивна Карта / ZONA <-> Етер <-> Ірмінсуль
 */

class EntropiaBridgeManager {
  constructor() {
    this.sessionId = localStorage.getItem('entropia_room_id') || 'ark_317_default';
    this.channelName = `entropia_channel_${this.sessionId}`;
    this.broadcast = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(this.channelName) : null;
    this.listeners = new Map();
    
    // Стан користувача
    this.role = localStorage.getItem('entropia_user_role') || 'player'; // 'gm' або 'player'
    this.character = this.loadStoredCharacter();

    this.initInternalListeners();
  }

  // --- Ініціалізація слухачів ---
  initInternalListeners() {
    // 1. Слухач вкладок браузера (BroadcastChannel)
    if (this.broadcast) {
      this.broadcast.onmessage = (event) => {
        this.emit(event.data.type, event.data.payload);
      };
    }

    // 2. Слухач фреймів iframe / вікон (postMessage)
    window.addEventListener('message', (event) => {
      if (event.data && event.data.source === 'ENTROPIA_BRIDGE') {
        this.emit(event.data.type, event.data.payload);
      }
    });
  }

  // --- Ролі та перевірка Майстра ---
  isGM() {
    return this.role === 'gm';
  }

  setRole(newRole) {
    this.role = newRole === 'gm' ? 'gm' : 'player';
    localStorage.setItem('entropia_user_role', this.role);
    this.send('ROLE_CHANGED', { role: this.role });
  }

  // --- Менеджмент персонажа ---
  loadStoredCharacter() {
    try {
      return JSON.parse(localStorage.getItem('entropia_active_char')) || {
        name: 'Невідомий',
        hp: 100,
        maxHp: 100,
        stats: { health: 10, attention: 10, combat: 10, agility: 10, thinking: 10, social: 10 }
      };
    } catch (e) {
      return null;
    }
  }

  updateCharacter(charData) {
    this.character = { ...this.character, ...charData };
    localStorage.setItem('entropia_active_char', JSON.stringify(this.character));
    this.send('CHAR_UPDATED', this.character);
  }

  getCharacter() {
    return this.character;
  }

  // --- Відправка події в усі доступні канали ---
  send(type, payload = {}) {
    const packet = {
      source: 'ENTROPIA_BRIDGE',
      type: type,
      payload: payload,
      senderRole: this.role,
      timestamp: Date.now()
    };

    // А. Відправка сусідам у вкладки
    if (this.broadcast) {
      this.broadcast.postMessage(packet);
    }

    // Б. Відправка дочірнім iframe (якщо ми батьківський сайт)
    const iframes = document.querySelectorAll('iframe');
    iframes.forEach(frame => {
      try {
        frame.contentWindow.postMessage(packet, '*');
      } catch (err) {}
    });

    // В. Відправка батьківському сайту (якщо ми всередині iframe)
    if (window.parent && window.parent !== window) {
      window.parent.postMessage(packet, '*');
    }

    // Локальний виклик для цього ж вікна
    this.emit(type, payload);
  }

  // --- Підписка на події ---
  on(type, callback) {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, []);
    }
    this.listeners.get(type).push(callback);
  }

  emit(type, payload) {
    if (this.listeners.has(type)) {
      this.listeners.get(type).forEach(cb => {
        try {
          cb(payload);
        } catch (err) {
          console.error(`[EntropiaBridge] Error in listener for ${type}:`, err);
        }
      });
    }
  }
}

// Глобальна ініціалізація
window.EntropiaBridge = new EntropiaBridgeManager();