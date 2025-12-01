import dotenv from 'dotenv'
dotenv.config()
import express from 'express'
import router from './routes/index.js'
import sequelize from './db.js'
import cors from 'cors'
import { createServer } from 'http'
import fileUpload from 'express-fileupload'
import errorHandler from './middleware/ErrorHandingMiddleware.js'
import { Server } from 'socket.io'
import initSocket from './socket/index.js'
import * as path from 'node:path'
import { fileURLToPath } from 'url'
import { dirname } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const PORT = process.env.PORT || 10000
const app = express()
const server = createServer(app)
const io = new Server(server, {
  cors: {
    origin: process.env.CLIENT_API_URL,
    methods: ['GET', 'POST'],
    credentials: true,
  },
})

app.use(
  cors({
    origin: process.env.CLIENT_API_URL,
    credentials: true,
  })
)
app.use(express.json())
app.use(express.static(path.resolve(__dirname, 'static')))
app.use(fileUpload({}))
app.use('/api', router)
app.use(errorHandler)

initSocket(io)

const start = async () => {
  try {
    await sequelize.authenticate()
    await sequelize.sync()
    // await sequelize.sync({ force: true })
    server.listen(PORT, '0.0.0.0', () =>
      console.log(`Server started on port ${PORT}`)
    )
  } catch (e) {
    console.log(e)
  }
}

start()
