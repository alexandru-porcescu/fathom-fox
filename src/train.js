/**
 * Awaitable setDefault that stores Promise values, not the Promises
 * themselves, in the map
 */
async function asyncSetDefault(map, key, asyncDefaultMaker) {
    if (map.has(key)) {
        return map.get(key);
    }
    const defaultValue = await asyncDefaultMaker();
    map.set(key, defaultValue);
    return defaultValue;
}

class Tuner {
    constructor(tabs, trainableId, initialTemperature = 5000, coolingSteps = 5000, coolingFraction = .95, stepsPerTemp = 1000) {
        this.INITIAL_TEMPERATURE = initialTemperature;
        this.COOLING_STEPS = coolingSteps;
        this.COOLING_FRACTION = coolingFraction;
        this.STEPS_PER_TEMP = stepsPerTemp;
        this.BOLTZMANNS = 1.3806485279e-23;

        this.tabs = tabs;
        this.trainableId = trainableId;
    }

    // Copy-and-pasted from Fathom just to allow solutionCost() to be async.
    // What color is your function?
    async anneal() {
        let temperature = this.INITIAL_TEMPERATURE;
        let currentSolution = this.initialSolution();
        let bestSolution = currentSolution;
        let currentCost = await this.solutionCost(currentSolution);
        let bestCost = currentCost;
        let m = 0;
        let n = 0;
        let hits = 0, misses = 0;
        const seenSolutions = new Map();  // solution => cost
        for (let i = 0; i < this.COOLING_STEPS; i++) {
            console.log('Cooling step', i, 'of', this.COOLING_STEPS, '...');
            const startCost = currentCost;
            for (let j = 0; j < this.STEPS_PER_TEMP; j++) {
                let newSolution = this.randomTransition(currentSolution);
                if (seenSolutions.has(newSolution.toString())) {
                    hits += 1;
                } else {
                    misses += 1;
                }
                let newCost = await asyncSetDefault(seenSolutions, newSolution.toString(), () => this.solutionCost(newSolution));

                if (newCost < currentCost) {
                    // Always take improvements.
                    currentCost = newCost;
                    currentSolution = newSolution;
                    if (newCost < bestCost) {
                        bestCost = newCost;
                        bestSolution = newSolution;
                        console.log('New best solution is ', newSolution, ' with cost ', newCost);
                    }
                } else {
                    // Sometimes take non-improvements.
                    const minusDelta = currentCost - newCost;
                    const merit = Math.exp(minusDelta / (this.BOLTZMANNS * temperature));
                    if (merit > Math.random()) {
                        m++;
                        currentCost = newCost;
                        currentSolution = newSolution;
                    }
                }
                n++;
                // Exit if we're not moving:
                if (startCost === currentCost) { break; }
            }
            temperature *= this.COOLING_FRACTION;
        }
        console.log('Iterations:', n, 'using', m, 'jumps.');
        console.log('Cache hits', hits, 'misses', misses);
        console.log('Cache hit rate', hits/(hits + misses));
        return bestSolution;
    }

    async solutionCost(coeffs) {
        // Send a message to all the pages in the corpus, telling them "Run
        // ruleset ID X (which carries its own right/wrong determiner which
        // itself knows what query to run), and tell me whether it was right or
        // wrong."
        const successes = await Promise.all(this.tabs.map(
            tab => browser.tabs.sendMessage(tab.id,
                                            {type: 'rulesetSucceeded',
                                             trainableId: this.trainableId,
                                             coeffs})));
        let numSuccesses = 0;
        for (const succeeded of successes) {
            if (succeeded) {
                numSuccesses += 1;
            }
            console.log(succeeded);
        }

        // When all complete, combine for a total score:
        return numSuccesses / successes.length;
    }

    randomTransition(solution) {
        return [1];
    }

    initialSolution() {
        return [1];
    }
}

async function trainOnTabs() {
    // Grey out Train button:
    document.getElementById('train').disabled = true;

    // TODO: Using "active" here rather than a tab ID presents a race condition
    // if you quickly switch away from the tab after clicking the Train button.
    const tabs = (await browser.tabs.query({currentWindow: true, active: false}));
    //await setViewportSize(tabs[0], 1024, 768);  // for consistent element sizing in samples due to text wrap, etc.

    const rulesetName = document.getElementById('ruleset').value;
    const tuner = new Tuner(tabs, rulesetName);
    const tunedCoeffs = await tuner.anneal();

    document.getElementById('coeffs').appendChild(document.createTextNode(`Tuned coefficients for ${rulesetName}: ${tunedCoeffs}.\n`));
    document.getElementById('train').disabled = false;
}

/**
 * Draw and outfit the Train page.
 */
function initPage(document) {
    document.getElementById('train').onclick = trainOnTabs;

    // Ruleset menu:
    const menu = document.getElementById('ruleset');
    for (const trainableKey of trainables.keys()) {
        const option = document.createElement('option');
        option.text = option.value = trainableKey;
        menu.add(option);
    }
}

initPage(document, trainables);