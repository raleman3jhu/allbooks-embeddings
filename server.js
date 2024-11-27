import reconcileEmbeddingsWithFaqs, {
  generateNewEmbedding,
  fetchSimilarDocs,
} from './lib/utils.js'
import express from 'express'
import clientPromise from './lib/mongodb.js'

const app = express()
const port = 3001

app.use(express.json())
app.use(express.static('public'))

app.post('/update-embeddings', async (req, res) => {
  try {
    await reconcileEmbeddingsWithFaqs()
    res
      .status(200)
      .json({ success: true, message: 'Embeddings updated successfully!' })
  } catch (error) {
    res.status(500).json({
      success: false,
      message: `Failed to update embeddings`,
      error: error.message,
    })
  }
})

app.get('/retrieve-similar-faqs', async (req, res) => {
  try {
    const { question, numCandidates, limit } = req.body
    const embedding = await generateNewEmbedding(question)
    const similarDocs = await fetchSimilarDocs(embedding, numCandidates, limit)

    res.status(200).json({ success: true, message: similarDocs })
  } catch (error) {
    res.status(500).json({
      success: false,
      message: `Failed to retrieve similar docs`,
      error: error.message,
    })
  }
})

const server = app.listen(port, () =>
  console.log(`Server running on http://localhost:${port}`)
)

// handle shutdown
process.on('SIGINT', async () => {
  const client = await clientPromise
  await client.close()
  server.close(() => {
    console.log('Server closed')
    process.exit(0)
  })
})
