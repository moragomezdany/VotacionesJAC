// ==========================================
// 1. ABSTRACCIÓN Y ENCAPSULAMIENTO
// ==========================================

export class Usuario {
  constructor(nombre) {
    this.nombre = nombre;
  }
}

// ==========================================
// 2. HERENCIA
// ==========================================

export class Vecino extends Usuario {
  #idDocumento; // ID único generado por Firebase
  #haVotado;    // Estado de votación traído de la BD

  constructor(idDocumento, nombre, haVotado = false) {
    super(nombre);
    this.#idDocumento = idDocumento;
    this.#haVotado = haVotado;
  }

  getIdDocumento() {
    return this.#idDocumento;
  }

  getHaVotado() {
    return this.#haVotado;
  }

  // Método asíncrono que delega la acción a la base de datos
  async votar(idPropuesta, gestorBD) {
    if (this.#haVotado) {
      throw new Error("El vecino ya tiene un voto registrado.");
    }
    
    // Inyección de dependencias: usamos el gestorBD para hablar con Firestore
    const exito = await gestorBD.registrarVotoEnBD(idPropuesta);
    
    if (exito) {
      this.#haVotado = true; // Actualizamos el estado del objeto en memoria
      return true;
    }
    return false;
  }
}

// ==========================================
// 3. POLIMORFISMO (Clases de Propuestas)
// ==========================================

export class Propuesta {
  #conteoVotos;

  constructor(id, titulo, descripcion, conteoVotos = 0) {
    this.id = id; // ID de Firestore
    this.titulo = titulo;
    this.descripcion = descripcion;
    this.#conteoVotos = conteoVotos;
  }

  getVotos() {
    return this.#conteoVotos;
  }

  incrementarVotos(cantidad = 1) {
    this.#conteoVotos += cantidad;
  }

  // Este método será redefinido (sobreescrito) por las clases hijas
  mostrarDetalle() {
    return `${this.titulo}: ${this.descripcion}`;
  }
}

// Subclase 1: Obras físicas
export class ProyectoInfraestructura extends Propuesta {
  constructor(id, titulo, descripcion, conteoVotos, presupuestoEstimado, duracionMeses) {
    super(id, titulo, descripcion, conteoVotos);
    this.presupuestoEstimado = presupuestoEstimado;
    this.duracionMeses = duracionMeses;
  }

  // Polimorfismo: Mismo nombre de método, comportamiento específico
  mostrarDetalle() {
    return `🏗️ OBRA: ${this.titulo} | Costo Estimado: $${this.presupuestoEstimado} | Duración: ${this.duracionMeses} meses`;
  }
}

// Subclase 2: Decisiones financieras
export class EleccionPresupuesto extends Propuesta {
  constructor(id, titulo, descripcion, conteoVotos, rubro) {
    super(id, titulo, descripcion, conteoVotos);
    this.rubro = rubro;
  }

  // Polimorfismo: Mismo nombre de método, comportamiento específico
  mostrarDetalle() {
    return `💰 PRESUPUESTO: ${this.titulo} | Fondo destinado a: ${this.rubro}`;
  }
}