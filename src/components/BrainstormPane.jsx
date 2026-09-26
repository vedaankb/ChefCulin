import { useEffect, useRef, useState } from 'react'
import { useWorkspace } from '../context/WorkspaceContext.jsx'

const QUICK = [
  'What do you notice?',
  'Suggest some directions',
  "What's missing?",
  'Write the dish up',
]

export default function BrainstormPane() {
  const { dish, chat, sendChat, variant, diagnosticCodes } = useWorkspace()
  const [text, setText] = useState('')
  const logRef = useRef(null)
  const riverside = variant === 'riverside'

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [chat])

  return (
    <section className="pane pane-b on">
      <p className="pane-intro">
        {riverside ? (
          <>
            A working conversation for clinical nutrition brainstorming. Conditions selected in
            Health stay in context. Chemistry links are corpus evidence — not prescriptions.
            {diagnosticCodes?.length
              ? ` ${diagnosticCodes.length} ICD condition${diagnosticCodes.length > 1 ? 's' : ''} in scope.`
              : ''}
          </>
        ) : (
          <>
            A working conversation about what to <em>do</em> with what you&apos;ve gathered. The
            system never chooses your ingredients — you did that. Arranging them is craft, and craft
            can be assisted. Replies go through the OpenAI proxy on the API server.
          </>
        )}
      </p>
      <div className="chatlog" ref={logRef}>
        {!chat.length ? (
          <div className="chat-empty">
            {dish.length === 0
              ? riverside
                ? 'Gather a few ingredients, or pick ICD conditions in Health, then think out loud.'
                : 'Gather a few ingredients first. The system will never choose them for you — that part is yours.'
              : `You have ${dish.length} ingredient${dish.length > 1 ? 's' : ''}. Ask what to do with them, or just think out loud.`}
          </div>
        ) : (
          chat.map((m, i) => (
            <div className={`msg ${m.who}`} key={i}>
              {m.who === 'sys' && <span className="msg-l">CulinAI</span>}
              <MessageContent content={m.content} />
            </div>
          ))
        )}
      </div>
      <div className="chatbar">
        <div className="quick">
          {QUICK.map((q) => (
            <button key={q} type="button" className="qb" onClick={() => sendChat(q)}>
              {q}
            </button>
          ))}
        </div>
        <div className="chatin">
          <input
            type="text"
            value={text}
            placeholder="Ask, think out loud, or tell it what you're seeing…"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                sendChat(text)
                setText('')
              }
            }}
          />
          <button
            type="button"
            onClick={() => {
              sendChat(text)
              setText('')
            }}
          >
            Send
          </button>
        </div>
      </div>
    </section>
  )
}

function MessageContent({ content }) {
  if (!content) return null
  if (content.type === 'text') return <p>{content.text}</p>
  if (content.type === 'writeup') {
    return (
      <div className="writeup">
        <div className="wu-h">The dish, as you have built it</div>
        <p className="wu-lead">{content.lead}</p>
        {!!content.formed?.length && (
          <>
            <div className="wu-s">Elements</div>
            <ul>
              {content.formed.map((d) => (
                <li key={d.name + d.mode}>
                  <strong>{d.name}</strong> — {d.mode.toLowerCase()}
                </li>
              ))}
            </ul>
          </>
        )}
        {!!content.unformed?.length && (
          <>
            <div className="wu-s">Still without a form</div>
            <p className="wu-note">
              {content.unformed.map((d) => d.name).join(', ')} — these are gathered but not
              placed.
            </p>
          </>
        )}
        <div className="wu-s">What it does</div>
        <ul>
          {Object.entries(content.jobs || {}).map(([job, ings]) => (
            <li key={job}>
              <strong>{job}</strong>: {ings.join(', ')}
            </li>
          ))}
        </ul>
        {!!content.unresolved?.length && (
          <>
            <div className="wu-s">Unresolved</div>
            <ul>
              {content.unresolved.map((x) => (
                <li key={x.slice(0, 40)}>{x}</li>
              ))}
            </ul>
          </>
        )}
        <div className="wu-foot">
          This is a description of what you designed, not a recipe. Say{' '}
          <em>&quot;draft the method&quot;</em> and I&apos;ll write the sequence — that part is
          wordsmithing.
        </div>
      </div>
    )
  }
  if (content.type === 'blocks') {
    return content.blocks.map((b, i) => {
      if (b.type === 'p') return <p key={i}>{b.text}</p>
      if (b.type === 'ask')
        return (
          <p className="ask" key={i}>
            {b.text}
          </p>
        )
      if (b.type === 'dir')
        return (
          <div className="dir" key={i}>
            <div className="dir-t">{b.t}</div>
            <div className="dir-b">{b.b}</div>
            <div className="dir-w">{b.w}</div>
          </div>
        )
      return null
    })
  }
  return null
}
