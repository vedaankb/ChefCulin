import { lookupIngredient } from './ingredients.js'
import { anchorProfileFor, axesForDb } from './balanceAxes.js'

export const AXES = {
    'rosemary':{}, 'juniper':{}, 'bay':{}, 'bergamot':{}, 'orange peel':{}, 'spruce':{}, 'fir':{},
    'roasted onion':{glut:1,sweet:1}, 'black garlic':{glut:1,sweet:1}, 'miso':{glut:1,salt:1},
    'porcini':{glut:1,nucl:1}, 'shiitake':{glut:1,nucl:1}, 'toasted grain':{}, 'cocoa':{},
    'verjus':{acid:1}, 'cider vinegar':{acid:1}, 'tart cherry':{acid:1,sweet:1}, 'blood orange':{acid:1,sweet:1},
    'black tea':{}, 'wine reduction':{acid:1}, 'pomegranate':{acid:1,sweet:1},
    'pancake':{}, 'cucumber':{}, 'scallion':{}, 'sweet bean sauce':{sweet:1,glut:1,salt:1}, 'radish':{},
    'fermented bean curd':{glut:1,salt:1}, 'taro':{}, 'water spinach':{}, 'ginger':{trigeminal:1}, 'rice noodle':{},
    'coconut milk':{fat:1,sweet:1}, 'red curry paste':{capsaicin:1,salt:1,glut:1}, 'lychee':{sweet:1},
    'thai basil':{}, 'makrut lime leaf':{},
    'vinegar':{acid:1}, 'cherry':{acid:1,sweet:1}, 'pickled shallot':{acid:1}, 'cabbage':{},
    'potato':{}, 'white bean':{}, 'bread':{}, 'rice':{}, 'dumpling':{},
    'soy':{glut:1,salt:1}, 'red wine':{acid:1}, 'mushroom':{glut:1,nucl:1}, 'duck jus':{glut:1,nucl:1,fat:1},
    'pappardelle':{}, 'soffritto':{sweet:1}, 'tomato':{acid:1,glut:1}, 'sage':{}, 'parmesan':{glut:1,nucl:1,salt:1,fat:1},
    'bitter orange':{acid:1}, 'gastrique':{acid:1,sweet:1}, 'wine vinegar':{acid:1},
    'ancho chile':{capsaicin:1}, 'pumpkin seed':{fat:1}, 'tomatillo':{acid:1}, 'cinnamon':{}, 'sesame':{fat:1},
    'red cabbage':{acid:1}, 'apple':{sweet:1,acid:1}, 'caraway':{},
    'thyme':{}, 'sage':{}, 'lavender':{}, 'makrut lime':{}, 'cardamom':{}, 'pink peppercorn':{trigeminal:1}, 'star anise':{},
    'coffee':{}, 'fish sauce':{glut:1,nucl:1,salt:1}, 'aged cheese':{glut:1,nucl:1,salt:1,fat:1}, 'dried shrimp':{glut:1,nucl:1,salt:1}, 'yeast extract':{glut:1,salt:1},
    'sumac':{acid:1}, 'tamarind':{acid:1,sweet:1}, 'green apple':{acid:1,sweet:1}, 'sorrel':{acid:1}, 'pickled walnut':{acid:1},
    'hoisin':{sweet:1,glut:1,salt:1}, 'garlic paste':{}, 'sugar':{sweet:1},
    'lettuce cup':{}, 'crepe':{}, 'pickled cucumber':{acid:1}, 'black vinegar':{acid:1}, 'chive oil':{fat:1}, 'shiso':{},
    'mustard greens':{}, 'coconut water':{sweet:1}, 'chile':{capsaicin:1}, 'lime':{acid:1},
    'white beans':{}, 'fennel':{}, 'kale':{}, 'celeriac':{}, 'rice ferment':{glut:1},
    'pineapple':{sweet:1,acid:1}, 'cherry tomato':{acid:1,glut:1}, 'galangal':{trigeminal:1},
    'grape':{sweet:1}, 'apricot':{sweet:1,acid:1}, 'peanut':{fat:1}, 'curry leaf':{}, 'coconut cream':{fat:1,sweet:1},
    'celery':{}, 'carrot':{sweet:1},
    'pecorino':{glut:1,nucl:1,salt:1,fat:1}, 'chestnut':{sweet:1}, 'black olive':{salt:1,glut:1}, 'orange zest':{}, 'anchovy':{glut:1,nucl:1,salt:1},
    'shallot':{}, 'stock':{glut:1,nucl:1},
    'blood orange':{acid:1,sweet:1}, 'quince':{sweet:1,acid:1}, 'sour cherry':{acid:1,sweet:1}, 'pomegranate molasses':{acid:1,sweet:1}, 'grapefruit':{acid:1},
    'pasilla chile':{capsaicin:1}, 'almond':{fat:1}, 'clove':{}, 'raisin':{sweet:1},
    'hazelnut':{fat:1}, 'walnut':{fat:1}, 'prune':{sweet:1}, 'smoked paprika':{capsaicin:1},
    'marjoram':{}, 'bacon':{salt:1,fat:1,glut:1}, 'vinegar':{acid:1},
    'rye bread':{}, 'horseradish':{pungent:1}, 'lingonberry':{acid:1,sweet:1}, 'buckwheat':{},
    'orange':{acid:1,sweet:1}, 'plum':{acid:1,sweet:1}, 'sauerkraut':{acid:1},
    'lentils':{}, 'polenta':{}, 'barley':{},
    'port':{sweet:1}, 'bone broth':{glut:1,nucl:1}
  };

export const COLORS = { compound:'var(--skin)', tradition:'var(--sage)', 'co-occurrence':'var(--plum)' };

export const FRAMES = {
    'Seared':             { produces:['crisp-skin','rendered-fat','intact-roast','rendered-jus'], absent:['dispersed-fat','long-cook','chopped-meat'], overlay:'sear',   fat:0.75 },
    'Crisp-skinned roast':{ produces:['crisp-skin','rendered-fat','intact-roast','rendered-jus'], absent:['dispersed-fat','chopped-meat'],             overlay:'roast',  fat:0.8  },
    /* Confit legs are routinely finished skin-down in a hot pan until crisp. The
       preservation stage and the finishing stage produce different properties —
       a frame is a PROCESS, not a settled end-state. Confit can absolutely be crisp. */
    'Confit':             { produces:['tender','fat-medium','salt-cured','long-cook','crisp-skin'], absent:['rendered-jus','intact-roast'], overlay:'confit', fat:0.95 },
    'Cold salted':        { produces:['salt-cured','firm','cold'],                                absent:['crisp-skin','rendered-fat','rendered-jus'], overlay:'cure',   fat:0.4  },
    'Broth system':       { produces:['dispersed-fat','liquid-body','long-cook','tender'],        absent:['crisp-skin','rendered-jus','intact-roast'], overlay:'broth',  fat:0.35 },
    'Braise':             { produces:['tender','long-cook','dispersed-fat','sauce-medium'],       absent:['crisp-skin','intact-roast'],                overlay:'braise', fat:0.6  },
    'Ground':             { produces:['dispersed-fat','chopped-meat','sauce-medium','long-cook'], absent:['crisp-skin','intact-roast','rendered-jus'], overlay:'ground', fat:0.55 },
    'Cured':              { produces:['salt-cured','firm','cold','dense'],                        absent:['crisp-skin','rendered-fat','tender'],       overlay:'cure',   fat:0.5  },
    'Smoked':             { produces:['smoke-phenols','rendered-fat'],                            absent:['fresh-crunch'],                             overlay:'smoke',  fat:0.7  },
    'Terrine / rillette': { produces:['fat-medium','cold','dense','tender'],                      absent:['crisp-skin','rendered-jus','intact-roast'], overlay:'terrine',fat:0.9  },
    'Raw / tartare':      { produces:['cold','chopped-meat','firm'],                              absent:['crisp-skin','rendered-fat','long-cook'],    overlay:'raw',    fat:0.35 },
    'Poached':            { produces:['tender','liquid-body'],                                    absent:['crisp-skin','rendered-fat'],                overlay:'broth',  fat:0.35 },
    'Steamed':            { produces:['tender'],                                                  absent:['crisp-skin','rendered-fat','long-cook'],    overlay:'broth',  fat:0.3  },
    'Grilled':            { produces:['crisp-skin','rendered-fat','smoke-phenols'],               absent:['dispersed-fat','long-cook'],                overlay:'sear',   fat:0.55 },
    'Roasted':            { produces:['rendered-fat','intact-roast'],                             absent:['dispersed-fat'],                            overlay:'roast',  fat:0.45 },
    'Charred':            { produces:['crisp-skin'],                                              absent:['long-cook','liquid-body'],                  overlay:'sear',   fat:0.4  },
    'Pickled':            { produces:['cold','salt-cured'],                                       absent:['rendered-fat','long-cook'],                 overlay:'cure',   fat:0.2  },
    'Puréed':             { produces:['dispersed-fat','sauce-medium','soft-carrier'],             absent:['crisp-skin','intact-roast'],                overlay:'ground', fat:0.5  },
    'Dried':              { produces:['dense','firm'],                                            absent:['rendered-jus','liquid-body'],               overlay:'cure',   fat:0.25 },
    'Infused':            { produces:['dispersed-fat'],                                           absent:['intact-roast'],                             overlay:'confit', fat:0.6  },
    'Bloomed in fat':     { produces:['dispersed-fat'],                                           absent:['intact-roast','crisp-skin'],                overlay:'ground', fat:0.7  },
    'Fresh garnish':      { produces:['fresh-crunch','cold'],                                     absent:['long-cook','rendered-fat'],                 overlay:'raw',    fat:0.2  },
    'Toasted':            { produces:['rendered-fat'],                                            absent:['liquid-body'],                              overlay:'sear',   fat:0.4  },
    'Boiled':             { produces:['tender','liquid-body','soft-carrier'],                     absent:['crisp-skin'],                               overlay:'broth',  fat:0.25 },
    'Melted':             { produces:['dispersed-fat','sauce-medium'],                            absent:['crisp-skin','intact-roast'],                overlay:'terrine',fat:0.85 },
    'Whipped':            { produces:['cold','dispersed-fat'],                                    absent:['long-cook','crisp-skin'],                   overlay:'terrine',fat:0.7  },
    'Cultured':           { produces:['cold','sauce-medium'],                                     absent:['crisp-skin','long-cook'],                   overlay:'cure',   fat:0.45 },
    'Fresh / raw':        { produces:['cold','fresh-crunch','firm'],                              absent:['long-cook','rendered-fat','crisp-skin'],    overlay:'raw',    fat:0.25 },
  };

export const OVERLAYS = {
    sear:    'Surface aromatics. The fat cap renders fast and carries aroma at the skin — herbs and citrus perfume the outside, they do not infuse the meat.',
    roast:   'Cavity and surface. Aromatics work on the skin, in the cavity, or in the pan juices — three different jobs in one frame.',
    confit:  'Infusion, not surface. Everything here spends hours in fat at low heat — aromatics infuse the medium rather than perfuming a surface. Delicate volatiles will be lost; robust ones deepen.',
    cure:    'Dry contact. No cooking medium to carry aroma — aromatics work by direct contact with salt, or afterwards as a dressing. Water leaves; flavour concentrates.',
    broth:   'Dispersion and timing. Aromatics disperse through liquid and can go muddy if over-extracted. When something goes in matters as much as whether it goes in.',
    braise:  'Long extraction. Robust aromatics survive and deepen; delicate ones vanish in the first hour. Late additions do different work from early ones.',
    ground:  'Distributed, not layered. Aromatics are mixed through the meat rather than sitting on it — seasoning is even, and there is no surface to perfume.',
    smoke:   'Fat carries phenols. Smoke compounds are fat-soluble, so the same rendered-fat phase that carries terpenes carries smoke — they will compete for the same channel.',
    terrine: 'Cold and set. Aroma is muted by cold and fat; season harder than seems right, and expect acid to be needed alongside, not on top.',
    raw:     'No heat, no extraction. Aromatics work by contact, cut size and surface area alone. Acid, salt and fat do all the carrying.'
  };

export const PROP_LABELS = {
    'crisp-skin':'crisp skin', 'fresh-crunch':'fresh crunch', 'soft-carrier':'a soft carrier',
    'dispersed-fat':'fat dispersed into the dish', 'liquid-body':'a liquid body',
    'chopped-meat':'chopped or shredded meat', 'sauce-medium':'a sauce medium',
    'rendered-jus':'rendered jus', 'intact-roast':'an intact roast', 'long-cook':'long cooking',
    'rendered-fat':'rendered fat', 'dark-meat':'dark meat'
  };

export { INGREDIENT_LIST } from './ingredients.js'

export const PROTEIN_PROFILES = {
  /* Deprecated — anchor axes now come from balance_axes.json (FooDB compounds). */
}

/** Balance anchor for whatever ingredient the chef is designing around. */
export function anchorFor(name) {
  if (!name) return { name: '', glut: 0, nucl: 0, fat: 0 }
  return anchorProfileFor(name)
}

export const DELIVERY = {
    /* axAdd = what the TRANSFORMATION creates that was not there before.
       Most modes add nothing — they change intensity and placement, not chemistry.
       Curry paste is capsaicin, salt and glutamate whether it is a rub or a sauce. */
    'red curry paste': [
      {mode:'Sauce base',        note:'Bloomed in fat, thinned with coconut. Aromatics disperse; the heat spreads through the whole dish rather than sitting on the protein.', axAdd:{fat:1}},
      {mode:'Broth',             note:'Diluted and simmered. Lower intensity, longer reach — background rather than statement.', axAdd:{}},
      {mode:'Rub, wiped before searing', note:'Aromatics hit the sear and enter the Maillard. Concentrated at the surface, almost none in the interior.', axAdd:{}},
      {mode:'Folded into a purée',       note:'Diluted by starch and sweetness. Squash blunts the heat and lengthens it.', axAdd:{sweet:1}},
      {mode:'Marinade',          note:'Penetrates over time; the salt does work on the protein as well as the flavour.', axAdd:{}}
    ],
    'scallion': [
      {mode:'Raw, sliced',       note:'Sharp allium bite, fresh and green. A cutting element.', axAdd:{}},
      {mode:'Charred',           note:'Sugars caramelise. The bite goes; sweetness and Maillard depth arrive that were not there before — this is a real change, not just an intensity one.', axAdd:{sweet:1, glut:1}},
      {mode:'Charred scallion oil', note:'The char carried in fat — aroma spreads through the dish rather than sitting on it.', axAdd:{sweet:1, glut:1, fat:1}},
      {mode:'Chimichurri / pesto', note:'Cut with acid and oil. Now a sauce with structure, not a garnish.', axAdd:{fat:1, acid:1}},
      {mode:'Confited in fat',   note:'Soft, sweet, silky. No bite at all.', axAdd:{fat:1, sweet:1}}
    ],
    'orange peel': [
      {mode:'Fresh zest',        note:'Volatile terpene oils at their brightest. Add late — heat drives them off.', axAdd:{}},
      {mode:'Infused in fat',    note:'The lipid phase captures the terpenes and releases them slowly. The lipid-phase principle in practice.', axAdd:{fat:1}},
      {mode:'Candied',           note:'Sugar enters the ingredient. A texture as much as a flavour.', axAdd:{sweet:1}},
      {mode:'Dried and ground',  note:'Concentrated, slightly bitter. Survives long cooking where fresh zest would not.', axAdd:{}},
      {mode:'In a gastrique',    note:'Sugar and vinegar reduced around it. Now structural — and now genuinely acidic, which the peel alone is not.', axAdd:{acid:1, sweet:1}}
    ],
    'miso': [
      {mode:'Glaze',             note:'Painted on and caramelised. Sugars brown at the surface.', axAdd:{sweet:1}},
      {mode:'In a sauce',        note:'Dispersed. Savoury depth throughout rather than concentrated.', axAdd:{}},
      {mode:'Marinade / cure',   note:'Salt and enzymes work into the protein over days. Texture changes, not just flavour.', axAdd:{}},
      {mode:'Whisked into butter', note:'Fat carries it; a finishing element rather than a base.', axAdd:{fat:1}}
    ],
    'cherry': [
      {mode:'Fresh / raw',       note:'Acid and sweet, juicy, cutting.', axAdd:{}},
      {mode:'Pickled',           note:'Vinegar enters the fruit. Genuinely more acidic than it was.', axAdd:{acid:1}},
      {mode:'Reduced into a sauce', note:'Water leaves; sugars concentrate. Body and gloss arrive.', axAdd:{sweet:1}},
      {mode:'Dried',             note:'Concentrated sweetness and a chew.', axAdd:{sweet:1}}
    ]
  };

const CLASS_DELIVERY = {
    liquid_alcohol: [   // wine, port, spirits
      {mode:'Reduced',       note:'Water and alcohol drive off; acid and sugar concentrate. Body and gloss arrive.', axAdd:{sweet:1}},
      {mode:'Deglazed into a pan', note:'Lifts the fond — the browned residue becomes part of the sauce. This is where the Maillard the sear built actually gets used.', axAdd:{glut:1}},
      {mode:'Macerated / soaked into fruit', note:'Carries alcohol and tannin into something else rather than standing alone.', axAdd:{}},
      {mode:'Braising liquid',  note:'Long, slow, dilute. The wine becomes background structure rather than a statement.', axAdd:{}},
      {mode:'Raw, as an acid finish', note:'Uncooked, sharp, with the alcohol still present. Rare — and deliberate.', axAdd:{acid:1}}
    ],
    vinegar_acid: [     // vinegar, verjus
      {mode:'Raw / finishing', note:'Added off-heat. Full sharpness intact.', axAdd:{}},
      {mode:'Reduced / gastrique', note:'Cooked with sugar until syrupy. Sour and sweet become one structure with body.', axAdd:{sweet:1}},
      {mode:'Pickling liquid', note:'Carries acid into something else — the vinegar becomes a delivery vehicle rather than an ingredient.', axAdd:{}},
      {mode:'In a vinaigrette', note:'Emulsified with fat. The fat blunts the edge and carries it further.', axAdd:{fat:1}},
      {mode:'Deglazed',        note:'Sharp and volatile — much of the acid cooks off, leaving the aromatic behind.', axAdd:{}}
    ],
    allium: [           // scallion, shallot, garlic, onion
      {mode:'Raw, sliced',   note:'Sharp, sulfurous bite. A cutting element.', axAdd:{}},
      {mode:'Charred',       note:'Sugars caramelise; the bite goes. Sweetness and Maillard depth arrive that were not there before.', axAdd:{sweet:1, glut:1}},
      {mode:'Slow-cooked / confited', note:'Soft, sweet, silky. Sulfur compounds break down entirely.', axAdd:{sweet:1, fat:1}},
      {mode:'Pickled',       note:'Acid enters; the bite becomes bright rather than harsh.', axAdd:{acid:1}},
      {mode:'As an oil',     note:'Carried in fat and spread through the dish rather than sitting on it.', axAdd:{fat:1}}
    ],
    herb: [             // rosemary, thyme, basil, sage
      {mode:'Fresh, finishing', note:'Volatile aromatics intact. Add late — heat drives them off.', axAdd:{}},
      {mode:'Infused in fat',  note:'The lipid phase captures the terpenes and releases them slowly. This is the lipid-phase principle in practice.', axAdd:{fat:1}},
      {mode:'Infused in liquid', note:'Water-soluble compounds only. A different, thinner extraction than fat gives.', axAdd:{}},
      {mode:'Dried',           note:'Volatiles diminish; the woody, resinous notes come forward.', axAdd:{}},
      {mode:'Charred / burnt',  note:'Smoke and bitterness enter. A different ingredient, really.', axAdd:{}}
    ],
    spice: [            // star anise, cinnamon, cardamom, pepper
      {mode:'Toasted whole',  note:'Heat drives Maillard in the spice itself — nuttier, rounder, less raw.', axAdd:{}},
      {mode:'Bloomed in fat', note:'Fat-soluble aromatics released and carried. The standard move, and it works for a reason.', axAdd:{fat:1}},
      {mode:'Ground raw',     note:'Sharpest and most volatile. Fades fastest.', axAdd:{}},
      {mode:'Steeped in liquid', note:'Slow, gentle extraction. Background rather than foreground.', axAdd:{}},
      {mode:'In a cure or rub', note:'Direct contact with the protein. Concentrated at the surface.', axAdd:{}}
    ],
    fruit: [            // cherry, plum, apple, quince
      {mode:'Fresh / raw',    note:'Acid, sweetness and juice, all intact.', axAdd:{}},
      {mode:'Pickled',        note:'Vinegar enters the fruit. Genuinely more acidic than it was.', axAdd:{acid:1}},
      {mode:'Reduced into a sauce', note:'Water leaves; sugars concentrate. Body and gloss arrive.', axAdd:{sweet:1}},
      {mode:'Roasted',        note:'Caramelisation. Sweetness deepens and acid softens.', axAdd:{sweet:1}},
      {mode:'Dried',          note:'Concentrated sweetness, and a chew.', axAdd:{sweet:1}}
    ],
    ferment: [          // miso, soy, fish sauce, fermented bean curd
      {mode:'Glaze',         note:'Painted on and caramelised. Sugars brown at the surface.', axAdd:{sweet:1}},
      {mode:'In a sauce',    note:'Dispersed. Savoury depth throughout rather than concentrated.', axAdd:{}},
      {mode:'Marinade / cure', note:'Salt and enzymes work into the protein over time. Texture changes, not just flavour.', axAdd:{}},
      {mode:'Whisked into fat', note:'Fat carries it; it becomes a finishing element rather than a base.', axAdd:{fat:1}},
      {mode:'In a broth',    note:'Diluted and dispersed — background savoury structure.', axAdd:{}}
    ],
    fungi: [            // porcini, shiitake, mushroom
      {mode:'Seared hard',   note:'Water leaves, Maillard arrives. Deeply savoury.', axAdd:{glut:1}},
      {mode:'Dried and rehydrated', note:'Drying concentrates the nucleotides sharply — a dried mushroom is far more umami-active than a fresh one.', axAdd:{glut:1, nucl:1}},
      {mode:'In a broth / dashi', note:'The guanylate extracts into the liquid. This is where the synergy lives.', axAdd:{nucl:1}},
      {mode:'Raw, shaved',   note:'Delicate, almost floral. Very little savoury depth.', axAdd:{}},
      {mode:'Confited in fat', note:'Silky, rich, saturated with the fat it cooked in.', axAdd:{fat:1}}
    ],
    starch: [           // potato, rice, bread, noodle, dumpling
      {mode:'Boiled / steamed', note:'Neutral, absorbent. A carrier for fat and sauce.', axAdd:{}},
      {mode:'Roasted / fried', note:'Surface Maillard; crisp exterior against a soft interior.', axAdd:{glut:1, fat:1}},
      {mode:'As a purée',     note:'Enriched with fat, smooth. Becomes a base rather than a component.', axAdd:{fat:1}},
      {mode:'Toasted',        note:'Nutty, dry, aromatic — a texture as much as a flavour.', axAdd:{}}
    ],
    dairy_fat: [        // butter, cream, coconut milk, oil
      {mode:'As a cooking medium', note:'Everything else passes through it. It carries the aromatics rather than adding its own.', axAdd:{}},
      {mode:'Emulsified into a sauce', note:'Body, gloss, and a carrier for fat-soluble aromatics.', axAdd:{}},
      {mode:'Browned',        note:'Milk solids Maillard — nutty, toasted, a genuinely different ingredient.', axAdd:{glut:1}},
      {mode:'Whipped / cold',  note:'Aeration and cold mute aroma. Season harder than seems right.', axAdd:{}},
      {mode:'Infused',        note:'The lipid phase captures aromatics and releases them slowly.', axAdd:{}}
    ],
    veg: [              // cucumber, cabbage, radish, zucchini
      {mode:'Raw',            note:'Crunch, water, freshness. A textural reset.', axAdd:{}},
      {mode:'Charred / grilled', note:'Water leaves, sugars caramelise, Maillard arrives.', axAdd:{sweet:1, glut:1}},
      {mode:'Pickled',        note:'Acid enters. Now it is a reset element, not just a texture.', axAdd:{acid:1}},
      {mode:'Roasted',        note:'Concentration and sweetness. The water goes.', axAdd:{sweet:1}},
      {mode:'As a purée',     note:'Smooth, enriched, a base rather than a component.', axAdd:{fat:1}}
    ]
  };

export const ING_CLASS = {
    'red wine':'liquid_alcohol','wine reduction':'liquid_alcohol','port':'liquid_alcohol','armagnac':'liquid_alcohol',
    'cider vinegar':'vinegar_acid','black vinegar':'vinegar_acid','wine vinegar':'vinegar_acid','verjus':'vinegar_acid','vinegar':'vinegar_acid','gastrique':'vinegar_acid',
    'scallion':'allium','shallot':'allium','garlic paste':'allium','roasted onion':'allium','black garlic':'allium','pickled shallot':'allium','chive oil':'allium','soffritto':'allium',
    'rosemary':'herb','thyme':'herb','sage':'herb','bay':'herb','juniper':'herb','spruce':'herb','fir':'herb','lavender':'herb','thai basil':'herb','marjoram':'herb','curry leaf':'herb','shiso':'herb','water spinach':'veg','mustard greens':'veg','kale':'veg',
    'star anise':'spice','cinnamon':'spice','cardamom':'spice','clove':'spice','pink peppercorn':'spice','caraway':'spice','sesame':'spice','cocoa':'spice','coffee':'spice','smoked paprika':'spice','ancho chile':'spice','pasilla chile':'spice','chile':'spice','ginger':'spice','galangal':'spice','horseradish':'spice','makrut lime leaf':'herb','makrut lime':'herb',
    'cherry':'fruit','tart cherry':'fruit','sour cherry':'fruit','plum':'fruit','apple':'fruit','quince':'fruit','pomegranate':'fruit','blood orange':'fruit','orange':'fruit','bitter orange':'fruit','grapefruit':'fruit','lychee':'fruit','pineapple':'fruit','grape':'fruit','apricot':'fruit','prune':'fruit','raisin':'fruit','tamarind':'fruit','green apple':'fruit','cranberry':'fruit','lingonberry':'fruit','tomato':'fruit','cherry tomato':'fruit','tomatillo':'fruit','lime':'fruit','sumac':'spice',
    'miso':'ferment','soy':'ferment','fish sauce':'ferment','fermented bean curd':'ferment','sweet bean sauce':'ferment','hoisin':'ferment','anchovy':'ferment','red curry paste':'ferment','rice ferment':'ferment','sauerkraut':'ferment','kimchi':'ferment','pickled cucumber':'veg','colatura':'ferment',
    'porcini':'fungi','shiitake':'fungi','mushroom':'fungi',
    'potato':'starch','rice':'starch','bread':'starch','dumpling':'starch','pancake':'starch','rice noodle':'starch','white bean':'starch','lentils':'starch','polenta':'starch','barley':'starch','toasted grain':'starch','taro':'starch','pappardelle':'starch','buckwheat':'starch','rye bread':'starch','chestnut':'starch',
    'coconut milk':'dairy_fat','coconut cream':'dairy_fat','parmesan':'ferment','pecorino':'ferment','aged cheese':'ferment','duck jus':'dairy_fat','stock':'dairy_fat','bone broth':'dairy_fat','pumpkin seed':'spice','almond':'spice','hazelnut':'spice','walnut':'spice','peanut':'spice','black olive':'ferment',
    'cucumber':'veg','radish':'veg','cabbage':'veg','red cabbage':'veg','fennel':'veg','celery':'veg','carrot':'veg','celeriac':'veg','zucchini':'veg','lettuce cup':'veg','crepe':'starch','sugar':'spice','honey':'spice','black tea':'spice','orange peel':'fruit','orange zest':'fruit','bergamot':'fruit','dried shrimp':'ferment','yeast extract':'ferment','sorrel':'herb','pickled walnut':'fruit','pomegranate molasses':'vinegar_acid','bacon':'ferment','coconut water':'dairy_fat','sweet potato':'veg','vanilla':'spice','pine nuts':'spice','basil':'herb','parsley':'herb','mint':'herb','capers':'ferment','olives':'ferment'
  };

export const REGION_PICKS = [
    { key:'china',                          label:'China' },
    { key:'vietnam',                        label:'Vietnam' },
    { key:'thailand',                       label:'Thailand' },
    { key:'italy',                          label:'Italy' },
    { key:'france',                         label:'France' },
    { key:'mexico',                         label:'Mexico' },
    { key:'czech,poland,hungary,germany',   label:'Central Europe' }
  ];

export const REGION_ALIASES = {
    beijing:'china', sichuan:'china', tuscany:'italy', umbria:'italy',
    gascon:'france', gascony:'france', 'central europe':'czech,poland,hungary,germany'
  };

export const FUNCTION_OF = {
    ferment:'savoury depth', fungi:'savoury depth', allium:'aromatic base',
    herb:'aromatic lift', spice:'aromatic lift', fruit:'acid and sweetness',
    vinegar_acid:'acid', liquid_alcohol:'acid and body', starch:'a carrier for the fat',
    dairy_fat:'fat and body', veg:'freshness and crunch'
  };

export const AXADD_JOB = { acid:'acid', sweet:'acid and sweetness', fat:'fat and body' };

export const FRAME_ALIASES = [
    { re:/\bcold[\s-]?salt/,               name:'Cold salted' },
    { re:/\bconfit/,                        name:'Confit' },
    { re:/\bbrais/,                         name:'Braise' },
    { re:/\bcrisp|roast/,                   name:'Crisp-skinned roast' },
    { re:/\bsear|magret/,                   name:'Seared' },
    { re:/\bcur(e|ed|ing)\b/,               name:'Cured' },
    { re:/\bbroth|soup/,                    name:'Broth system' },
    { re:/\bground|ragu|ragù|minced|sausage/, name:'Ground' },
    { re:/\bsmoke/,                         name:'Smoked' },
    { re:/\bterrine|rillette|pat[eé]/,      name:'Terrine / rillette' },
    { re:/\braw\b|tartare|carpaccio|crudo/, name:'Raw / tartare' }
  ];

export function modesFor(name) {
  const key = String(name || '')
  if (DELIVERY[key]) return DELIVERY[key]
  const lower = key.toLowerCase()
  if (DELIVERY[lower]) return DELIVERY[lower]
  const cls = classForIngredient(key)
  if (cls && CLASS_DELIVERY[cls]) return CLASS_DELIVERY[cls]
  return null
}

const GROUP_AXES = {
  Fruits: { acid: 1, sweet: 1 },
  Nuts: { fat: 1 },
  'Milk and milk products': { fat: 1 },
  'Cocoa and cocoa products': { fat: 1, sweet: 1 },
  Confectioneries: { sweet: 1 },
  Soy: { glut: 1 },
  'Animal foods': { nucl: 1 },
  'Aquatic foods': { glut: 1, nucl: 1 },
}

function axesFromFoodb(name) {
  const row = lookupIngredient(name)
  if (!row) return {}
  const blob = `${row.name} ${row.food_group} ${row.food_subgroup}`.toLowerCase()
  if (/vinegar/.test(blob)) return { acid: 1 }
  if (/capsicum|chile|chili pepper|hot pepper/.test(blob)) return { capsaicin: 1 }
  if (/soy sauce|miso|fish sauce/.test(blob)) return { glut: 1, salt: 1 }
  if (/citrus|lemon|lime|grapefruit/.test(blob)) return { acid: 1 }
  if (/onion-family|garlic/.test(blob)) return {}
  if (row.food_subgroup === 'Herbs') return {}
  if (row.food_subgroup === 'Spices') return {}
  return GROUP_AXES[row.food_group] || {}
}

/** FooDB compound DB first, then legacy demo nicknames, then taxonomy hints. */
export function axesFor(name) {
  const db = axesForDb(name)
  if (Object.keys(db).length) return db

  const key = String(name || '')
  const lower = key.toLowerCase()
  if (AXES[key]) return AXES[key]
  if (AXES[lower]) return AXES[lower]
  const toks = lower.replace(/[()]/g, ' ').split(/[\s,/]+/).filter((w) => w.length >= 3)
  for (const t of toks) {
    if (AXES[t] && Object.keys(AXES[t]).length) return AXES[t]
  }
  let merged = {}
  for (const [k, v] of Object.entries(AXES)) {
    if (k.length >= 4 && lower.includes(k) && Object.keys(v).length) merged = { ...merged, ...v }
  }
  if (Object.keys(merged).length) return merged
  return axesFromFoodb(key)
}

function classForIngredient(name) {
  const key = String(name || '')
  const lower = key.toLowerCase()
  if (ING_CLASS[key]) return ING_CLASS[key]
  if (ING_CLASS[lower]) return ING_CLASS[lower]
  const toks = lower.replace(/[()]/g, ' ').split(/[\s,/]+/)
  for (const t of toks) {
    if (ING_CLASS[t]) return ING_CLASS[t]
  }
  const row = lookupIngredient(name)
  if (!row) return null
  const g = row.food_group || ''
  const sg = row.food_subgroup || ''
  if (/onion/i.test(sg) || /garlic/i.test(lower)) return 'allium'
  if (/vinegar/i.test(lower)) return 'vinegar_acid'
  if (g === 'Fruits') return 'fruit'
  if (sg === 'Herbs') return 'herb'
  if (sg === 'Spices' || /capsicum|chile/i.test(`${lower} ${sg}`)) return 'spice'
  if (g === 'Herbs and Spices') return sg === 'Herbs' ? 'herb' : 'spice'
  if (g === 'Vegetables' || g === 'Gourds') return 'veg'
  if (g === 'Cereals and cereal products' || g === 'Baking goods' || g === 'Pulses') return 'starch'
  if (g === 'Nuts') return 'spice'
  if (g === 'Milk and milk products') return 'dairy_fat'
  if (g === 'Soy') return 'ferment'
  if (/mushroom|fungi/i.test(`${g} ${sg}`)) return 'fungi'
  return null
}
