function mostrarFotos() {
  const contenedor = document.getElementById("marcos");
  const estado = document.getElementById("estadoFotos");

  if (!contenedor || !estado) {
    console.error('No se encontraron los elementos "marcos" o "estadoFotos".');
    return;
  }

  contenedor.replaceChildren();

  let fotos = [];

  try {
    const almacenadas = sessionStorage.getItem("fotosSeleccionadas");
    const datos = JSON.parse(almacenadas || "[]");

    if (Array.isArray(datos)) {
      fotos = datos
        .filter(foto => typeof foto === "string" && foto.length > 0)
        .slice(0, 10);
    }
  } catch (error) {
    console.error("Error al recuperar las fotografías:", error);
  }

  for (let i = 0; i < 10; i++) {
    const marco = document.createElement("div");
    marco.className = "marco-item";

    const ventana = document.createElement("div");
    ventana.className = "foto-ventana";

    if (fotos[i]) {
      const foto = document.createElement("img");

      foto.src = fotos[i];
      foto.alt = "Foto seleccionada " + (i + 1);
      foto.loading = "lazy";

      foto.style.width = "100%";
      foto.style.height = "100%";
      foto.style.objectFit = "cover";
      foto.style.display = "block";

      ventana.appendChild(foto);
    }

    const borde = document.createElement("img");

    borde.className = "marco-superpuesto";
    borde.src = "marco.png";
    borde.alt = "Marco SENATI";
    borde.draggable = false;

    marco.appendChild(ventana);
    marco.appendChild(borde);
    contenedor.appendChild(marco);
  }

  estado.textContent = fotos.length
    ? `${fotos.length} foto(s) colocada(s) en sus marcos.`
    : "No hay fotos seleccionadas.";
}