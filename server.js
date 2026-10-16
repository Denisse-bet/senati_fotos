require("dotenv").config();

const express = require("express");
const { Pool } = require("pg");
const path = require("path");
const crypto = require("crypto");

const app = express();
const PORT = Number(process.env.PORT || 3000);

const pool = new Pool({
  host: process.env.DB_HOST || "localhost",
  port: Number(process.env.DB_PORT || 5432),
  database: process.env.DB_NAME || "senati_fotos",
  user: process.env.DB_USER || "postgres",
  password: process.env.DB_PASSWORD,
  ssl: process.env.DB_SSL === "true"
    ? { rejectUnauthorized: true }
    : false,
  connectionTimeoutMillis: 10000
});

app.disable("x-powered-by");

// Permite recibir los datos y fotos enviados desde el formulario.
app.use(express.json({ limit: "25mb" }));

// Sirve las páginas HTML y sus imágenes desde la carpeta public.
app.use(express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index (2).html"));
});

// Comprueba si PostgreSQL está conectado.
app.get("/api/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ ok: true, database: "connected" });
  } catch (error) {
    console.error("Error de conexión:", error.message);
    res.status(503).json({
      ok: false,
      error: "No se pudo conectar con PostgreSQL."
    });
  }
});

function validarContacto(valor) {
  const contacto = String(valor || "").trim();

  if (contacto.includes("@")) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contacto)
      ? { valido: true, tipo: "email", valor: contacto }
      : { valido: false };
  }

  const digitos = contacto.replace(/\D/g, "");

  if (/^[+\d\s().-]+$/.test(contacto) && digitos.length >= 9) {
    return { valido: true, tipo: "celular", valor: contacto };
  }

  return { valido: false };
}

function convertirFoto(dataURL) {
  if (typeof dataURL !== "string") {
    throw new Error("Una fotografía no tiene un formato válido.");
  }

  const coincidencia = dataURL.match(
    /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/
  );

  if (!coincidencia) {
    throw new Error("Las fotos deben ser JPG, PNG o WebP.");
  }

  const mimeType = coincidencia[1];
  const buffer = Buffer.from(coincidencia[2], "base64");

  if (buffer.length === 0 || buffer.length > 5 * 1024 * 1024) {
    throw new Error("Cada foto debe pesar como máximo 5 MB.");
  }

  return { mimeType, buffer };
}

// Guarda el registro y todas sus fotografías en una transacción.
app.post("/api/registros", async (req, res) => {
  const nombre = String(req.body.nombre || "").trim();
  const contacto = validarContacto(req.body.contacto);
  const autorizacion =
    req.body.autorizacionDatosPersonales === true;
  const fotos = req.body.fotos;

  if (nombre.length < 2 || nombre.length > 200) {
    return res.status(400).json({
      error: "Ingresa tu nombre y apellido."
    });
  }

  if (!contacto.valido) {
    return res.status(400).json({
      error: "Ingresa un correo válido o un celular de mínimo 9 dígitos."
    });
  }

  if (!autorizacion) {
    return res.status(400).json({
      error: "Debes autorizar el tratamiento de tus datos personales."
    });
  }

  if (!Array.isArray(fotos) || fotos.length < 1 || fotos.length > 10) {
    return res.status(400).json({
      error: "Selecciona entre 1 y 10 fotografías."
    });
  }

  let fotosPreparadas;

  try {
    fotosPreparadas = fotos.map(convertirFoto);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }

  let cliente;

  try {
    cliente = await pool.connect();
    await cliente.query("BEGIN");

    const token = crypto.randomUUID();

    const resultado = await cliente.query(
      `INSERT INTO registros
        (public_token, nombre, contacto, tipo_contacto, acepto_datos)
       VALUES ($1, $2, $3, $4, TRUE)
       RETURNING id, public_token, fecha_registro`,
      [
        token,
        nombre,
        contacto.valor,
        contacto.tipo
      ]
    );

    const registro = resultado.rows[0];

    for (let i = 0; i < fotosPreparadas.length; i++) {
      const foto = fotosPreparadas[i];

      await cliente.query(
        `INSERT INTO fotos
          (registro_id, nombre_archivo, mime_type,
           datos, peso_bytes, orden)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          registro.id,
          `foto-${i + 1}.${foto.mimeType === "image/png"
            ? "png"
            : foto.mimeType === "image/webp" ? "webp" : "jpg"}`,
          foto.mimeType,
          foto.buffer,
          foto.buffer.length,
          i + 1
        ]
      );
    }

    await cliente.query("COMMIT");

    res.status(201).json({
      ok: true,
      token: registro.public_token,
      cantidadFotos: fotosPreparadas.length,
      fecha: registro.fecha_registro
    });

  } catch (error) {
    if (cliente) {
      await cliente.query("ROLLBACK").catch(() => {});
    }

    console.error("Error al guardar:", error.message);

    res.status(500).json({
      error: "No se pudieron guardar los datos y las fotografías."
    });

  } finally {
    if (cliente) cliente.release();
  }
});

// Consulta las fotografías asociadas a un registro.
app.get("/api/registros/:token/fotos", async (req, res) => {
  try {
    const resultado = await pool.query(
      `SELECT r.id, r.nombre, r.fecha_registro,
              f.id AS foto_id, f.nombre_archivo,
              f.mime_type, f.orden
       FROM registros r
       LEFT JOIN fotos f ON f.registro_id = r.id
       WHERE r.public_token = $1
       ORDER BY f.orden`,
      [req.params.token]
    );

    if (!resultado.rowCount) {
      return res.status(404).json({
        error: "Registro no encontrado."
      });
    }

    const primero = resultado.rows[0];

    res.json({
      ok: true,
      registro: {
        id: primero.id,
        nombre: primero.nombre,
        fecha: primero.fecha_registro
      },
      fotos: resultado.rows
        .filter(f => f.foto_id !== null)
        .map(f => ({
          id: f.foto_id,
          nombre: f.nombre_archivo,
          tipo: f.mime_type,
          orden: f.orden,
          url: `/api/fotos/${f.foto_id}/imagen?token=${encodeURIComponent(req.params.token)}`
        }))
    });

  } catch (error) {
    console.error(error.message);
    res.status(500).json({
      error: "No se pudieron consultar las fotografías."
    });
  }
});

// Entrega una foto guardada en la base de datos.
app.get("/api/fotos/:id/imagen", async (req, res) => {
  const id = Number(req.params.id);
  const token = req.query.token;

  if (!Number.isSafeInteger(id) || id < 1 || !token) {
    return res.status(400).send("Solicitud inválida.");
  }

  try {
    const resultado = await pool.query(
      `SELECT f.datos, f.mime_type
       FROM fotos f
       JOIN registros r ON r.id = f.registro_id
       WHERE f.id = $1 AND r.public_token = $2`,
      [id, token]
    );

    if (!resultado.rowCount) {
      return res.status(404).send("Foto no encontrada.");
    }

    res.setHeader("Content-Type", resultado.rows[0].mime_type);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "private, no-store");
    res.send(resultado.rows[0].datos);

  } catch (error) {
    console.error(error.message);
    res.status(500).send("Error al consultar la foto.");
  }
});

async function iniciar() {
  try {
    await pool.query("SELECT 1");

    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Servidor SENATI activo en http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error(
      "No se pudo conectar con PostgreSQL. Revisa el archivo .env:",
      error.message
    );
    process.exit(1);
  }
}

iniciar();