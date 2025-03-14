import { surveyLevelToNumber } from "$lib/game-utils.js"
import { CONDITION_EFFECTS } from "$lib/condition-effects.js"
import { Stat } from "$lib/stat.js"
import { INDUSTRIES } from "$lib/Industries.js"
import { nonneg } from "$lib/utils.js"
import { COMMODITIES } from "$lib/commodities.js"
import { fleetQualityDoctrine, fleetSizeDoctrine } from "$lib/save-reader.js"
import { cachedConds } from "$lib/criteria-options.js"

export class Body {
	/**
	 * @param {string} id
	 * @param {System} system
	 * @param {string} name
	 * @param {string} type
	 * @param {string} surveyLevel
	 * @param {string[]} keywords
	 * @param {string[]} tags
	 * @param {"none" | "false" | "true"} ruinExplored
	 * @param {number} coreTechMiningMult
	 */
	constructor(id, system, name, type, surveyLevel, keywords, tags, ruinExplored, coreTechMiningMult) {
		this.id = id
		this.system = system
		this.name = name
		this.type = type
		this.size = 6 // Market size, not actual planet size
		this.surveyLevel = surveyLevelToNumber(surveyLevel)
		this.keywords = keywords
		if (this.keywords) {
			this.setConditions(this.keywords)
		}
		this.setConditionsV2(this.keywords)
		this.tags = tags

		this.coronalTap = false
		this.coronalTapDiscovered = false
		this.cryosleeper = false
		this.cryosleeperDiscovered = false
		this.domainRelay = false
		this.domainRelayDiscovered = false
		this.gate = false
		this.gateDiscovered = false

		this.ruinExplored = ruinExplored
		if (this.ruinExplored === "none" && this.keywords != null) {
			if (
				this.keywords.includes("ruins_scattered") ||
				this.keywords.includes("ruins_widespread") ||
				this.keywords.includes("ruins_extensive") ||
				this.keywords.includes("ruins_vast")
			) {
				this.ruinExplored = "false"
			}
		}
		this.coreTechMiningMult = coreTechMiningMult

		this.evaluateArtifacts()
	}

	setConditionsV2(keywords) {
		this.conditionsV2 = {}
		this.conditionGroups = {}
		for (const keyword of keywords) {
			const cond = cachedConds()[keyword]

			if (cond == null) continue

			this.conditionsV2[keyword] = cond
			this.conditionGroups[cond.group] = cond
		}
	}

	setConditions(keywords) {
		this.conditions = {
			decivilization: 0,
			temperature: 2,
			tectonics: 0,
			atmosphere: 2,
			weather: 1,
			gravity: 1,
			radiation: 0,
			biosphere: 0,
			water: 0,
			light: 2,
			meteors: 0,
			techmining: 0,
			mining: 0,
			farming: 0,
			aquaculture: 0,
			pollution: 0,
		}
		for (const keyword of keywords) {
			const effects = CONDITION_EFFECTS[keyword]
			for (const cond in effects) {
				if (cond !== "hazardRating" && cond !== "stability") {
					this.conditions[cond] = effects[cond]
				}
			}
		}
	}

	getStats(criteria) {
		const stats = {
			accessibility: new Stat(),
			hazardRating: new Stat(1, "Base value"),
			stability: new Stat(5, "Base value"), // clamped 0-10
			groundForces: new Stat(),
			fleetSize: new Stat(),
			shipQuality: new Stat(),
			growth: 0, // TODO: Pay more attention to this. Growth rate % equals growth / (300 * 2 ^ (size - 3))
			income: new Stat(),
			upkeep: new Stat(),
			profit: new Stat(),
			lampHeat: 0,
			tapIndustry: 0,
		}

		for (const keyword of this.keywords) {
			const effects = CONDITION_EFFECTS[keyword]
			for (const cond in effects) {
				if (cond === "hazardRating") {
					stats.hazardRating.add(effects[cond], effects.name)
				} else if (cond === "stability") {
					stats.stability.add(effects[cond], effects.name)
				}
			}
		}

		if (this.keywords.includes("solar_array")) {
			stats.hazardRating.unadd(CONDITION_EFFECTS.hot.name)
			stats.hazardRating.unadd(CONDITION_EFFECTS.poor_light.name)
		}

		if (criteria.structures.population.orbital_fusion_lamp_optional) {
			if (
				stats.hazardRating.includes(CONDITION_EFFECTS.cold.name) ||
				stats.hazardRating.includes(CONDITION_EFFECTS.very_cold.name) ||
				stats.hazardRating.includes(CONDITION_EFFECTS.poor_light.name) ||
				stats.hazardRating.includes(CONDITION_EFFECTS.dark.name)
			) {
				criteria.structures.population.artifact = "orbital_fusion_lamp"
				criteria.structures.population.orbital_fusion_lamp = true
			} else {
				delete criteria.structures.population.artifact
				delete criteria.structures.population.orbital_fusion_lamp_optional
			}
		}

		if (criteria.structures.population.orbital_fusion_lamp) {
			stats.hazardRating.unadd(CONDITION_EFFECTS.cold.name)
			stats.hazardRating.unadd(CONDITION_EFFECTS.very_cold.name)
			stats.hazardRating.unadd(CONDITION_EFFECTS.poor_light.name)
			stats.hazardRating.unadd(CONDITION_EFFECTS.dark.name)
			if (this.keywords.includes("hot")) {
				stats.hazardRating.unadd(CONDITION_EFFECTS.hot.name)
				stats.hazardRating.add(CONDITION_EFFECTS.very_hot.hazardRating, CONDITION_EFFECTS.very_hot.name)
				stats.lampHeat = 1
			} else if (
				!(
					this.keywords.includes("very_hot") ||
					this.keywords.includes("cold") ||
					this.keywords.includes("very_cold")
				)
			) {
				stats.hazardRating.add(CONDITION_EFFECTS.hot.hazardRating, CONDITION_EFFECTS.hot.name)
				stats.lampHeat = 1
			}
		}

		return stats
	}

	evaluateArtifacts() {
		this.possibleArtifacts = {
			coronalPortal: true, // Hypershunt Tap. See consider_other_factors for 10 ly logic.
			orbitalFusionLamp: true,
			fullereneSpool: this.type !== "gas_giant" && this.conditions.weather < 2 && this.conditions.tectonics < 2,
			soilNanites:
				this.conditions.farming && !("rare_ore" in this.conditions) && !("volatiles" in this.conditions),
			mantleBore: this.type !== "gas_giant" && !this.keywords.includes("habitable"),
			plasmaDynamo: this.type === "gas_giant", // TODO: || ice_giant
			catalyticCore: this.conditions.atmosphere === 0,
			biofactoryEmbryo: this.keywords.includes("habitable"),
			corruptedNanoforge: true,
			pristineNanoforge: true,
			synchrotron: this.conditions.atmosphere === 0,
			dealmakerHolosuite: true,
			cryoarithmeticEngine: this.keywords.includes("hot") || this.keywords.includes("very_hot"), // Installable on Hot planet with Orbital Solar Array!
			droneReplicator: true,
		}
	}

	applyStructureEffects(stats, structure, config, timing) {
		const effectFunc = timing === "early" ? "early_effects" : "effects"
		if (!(effectFunc in INDUSTRIES[structure])) {
			return false
		}
		const effects = INDUSTRIES[structure][effectFunc](this, stats, config) || {}
		for (const cond in effects) {
			if (cond.endsWith("_multiplier")) {
				stats[cond].push(effects[cond])
			} else {
				// TODO: Does this even happen?
				this.conditions[cond] += effects[cond]
			}
		}
	}

	/**
	 *
	 * @param {Colony} criteria
	 * @param {number} spoilerLevel
	 * @return {boolean}
	 */
	prefilterStructures(criteria, spoilerLevel = 0) {
		const planetTypeMatch = criteria.planetTypes.size > 0 ? criteria.planetTypes.has(this.type) : true
		if (!planetTypeMatch) return false

		// key = group (ruins), value = amount (ruins_widespread)
		for (const [key, value] of criteria.conditions.gte.entries()) {
			if (value === `${key}_any`) continue // any = we don't care about this

			const wantNone = value === `${key}_none`
			if (wantNone) {
				if (this.conditionGroups[key] != null) return false
				continue // continue the loop, none/null is what we want and if we don't continue we crash from NPE
			} else {
				if (this.conditionGroups[key] == null) return false
			}

			// I've made an assumption that comparing by rank makes sense. For vanilla, it seems to.
			const match = this.conditionGroups[key].rank >= cachedConds()[value].rank
			if (!match) return false
		}

		for (const [key, value] of criteria.conditions.exact.entries()) {
			if (value === `${key}_any`) continue // any = we don't care about this

			const wantNone = value === `${key}_none`
			if (wantNone) {
				const match = this.conditionsV2[key] == null
				if (!match) return false
			} else {
				const match = this.conditionsV2[key] != null
				if (!match) return false
			}
		}

		return true
		const needs = criteria.structures
		return !(
			(needs.techmining && !this.conditions.techmining) ||
			(needs.farmingaquaculture && !(this.conditions.farming || this.conditions.aquaculture)) ||
			(needs.mining && !this.conditions.mining) ||
			(needs.population?.coronalPortal &&
				((spoilerLevel === 0 && this.coronalTapDiscovered === false) ||
					(spoilerLevel > 0 && this.coronalTap === false))) ||
			((needs.spaceport?.fullereneSpool || needs.megaport?.fullereneSpool) &&
				!this.possibleArtifacts.fullereneSpool) ||
			(needs.farmingaquaculture?.soilNanites && !this.possibleArtifacts.soilNanites) ||
			(needs.mining?.mantleBore && !this.possibleArtifacts.mantleBore) ||
			(needs.mining?.plasmaDynamo && !this.possibleArtifacts.plasmaDynamo) ||
			(needs.refining?.catalyticCore && !this.possibleArtifacts.catalyticCore) ||
			(needs.lightindustry?.biofactoryEmbryo && !this.possibleArtifacts.biofactoryEmbryo) ||
			(needs.fuelprod?.synchrotron && !this.possibleArtifacts.synchrotron) ||
			(!this.possibleArtifacts.cryoarithmeticEngine &&
				(needs.patrolhq?.cryoarithmeticEngine ||
					needs.militarybase?.cryoarithmeticEngine ||
					needs.highcommand?.cryoarithmeticEngine)) ||
			(needs.cryorevival &&
				((spoilerLevel === 0 && this.cryosleeperDiscovered === false) ||
					(spoilerLevel > 0 && this.cryosleeper === false))) ||
			(criteria.market.domainRelay &&
				((spoilerLevel === 0 && !this.domainRelayDiscovered) || (spoilerLevel > 0 && !this.domainRelay))) ||
			(criteria.market.gate &&
				((spoilerLevel === 0 && !this.gateDiscovered) || (spoilerLevel > 0 && !this.gate))) ||
			(criteria.market.solar_array && !this.keywords.includes("solar_array"))
		)
	}

	renameFarmingaquaculture(criteria) {
		if (criteria.structures.farmingaquaculture) {
			if (this.conditions.farming) {
				criteria.structures.farming = criteria.structures.farmingaquaculture
			} else if (this.conditions.aquaculture) {
				criteria.structures.aquaculture = criteria.structures.farmingaquaculture
			}
			delete criteria.structures.farmingaquaculture
		}
	}

	calculateAccessibility(criteria, stats, economy) {
		// Accessibility can be negative
		const distanceAccess = economy.search_markets[criteria.new_colony_id].proximity_isolation
		if (distanceAccess >= 0) {
			stats.accessibility.add(distanceAccess, "Proximity to other colonies")
		} else {
			stats.accessibility.add(distanceAccess, "Isolation from other colonies")
		}
		stats.accessibility.add(-economy.faction_hostilities.player, "Hostilities with other factions")
		if (this.conditions.gravity === 0) {
			stats.accessibility.add(0.1, CONDITION_EFFECTS.low_gravity.name)
		} else if (this.conditions.gravity === 2) {
			stats.accessibility.add(-0.1, CONDITION_EFFECTS.high_gravity.name)
		}
		if (this.size >= 5) {
			stats.accessibility.add(0.1 + 0.05 * nonneg(this.size - 5), "Colony size")
		}
		if (!("spaceport" in criteria.structures || "megaport" in criteria.structures)) {
			stats.accessibility.add(-1, "No spaceport")
		}
		if (criteria.market.free_port) {
			stats.accessibility.add(0.25, "Free port")
		}
		if (criteria.market.hypercognition) {
			stats.accessibility.add(0.1, "Hypercognition")
		}
		for (const structure in criteria.structures) {
			this.applyStructureEffects(stats, structure, criteria.structures[structure], "early")
		}
	}

	calculateDemand(criteria, stats) {
		stats.demands = {}
		for (const structure in criteria.structures) {
			const config = criteria.structures[structure]
			if ("demands" in INDUSTRIES[structure]) {
				const structDemands = INDUSTRIES[structure].demands(this, stats, config)
				const aiCoreDiscount = config.aicore ? 1 : 0
				for (const commodity in structDemands) {
					stats.demands[commodity] = Math.max(
						stats.demands[commodity] ?? 0,
						nonneg(structDemands[commodity] - aiCoreDiscount),
					)
				}
			}
		}
	}

	calculateCommodityPool(stats, crossfaction_supply, infaction_supply) {
		stats.commodities = {}
		const portCap = Math.max(0, Math.floor(stats.accessibility.value() * 10))
		const infactionCap = Math.max(0, Math.floor(stats.accessibility.value() * 10) + 5)
		for (const commodity_id in COMMODITIES) {
			const commodity = {
				demanded: stats.demands[commodity_id] ?? 0,
				produced: stats.products[commodity_id] ?? 0,
				used_local: 0,
				available_infaction: Math.min(infactionCap, infaction_supply[commodity_id] ?? 0),
				imported_infaction: 0,
				available_crossfaction: Math.min(portCap, crossfaction_supply[commodity_id] ?? 0),
				imported_crossfaction: 0,
				shortage: 0,
			}
			commodity.used_local = Math.min(commodity.demanded, commodity.produced)
			let needed = nonneg(commodity.demanded - commodity.produced)
			if (needed > 0) {
				if (
					commodity.available_crossfaction > commodity.available_infaction &&
					commodity.demanded > commodity.available_infaction
				) {
					const desired_import = nonneg((crossfaction_supply[commodity_id] ?? 0) - commodity.produced)
					commodity.imported_crossfaction = Math.min(needed, desired_import, commodity.available_crossfaction)
				} else {
					const desired_import = nonneg((infaction_supply[commodity_id] ?? 0) - commodity.produced)
					commodity.imported_infaction = Math.min(needed, desired_import, commodity.available_infaction)
				}
				needed = nonneg(needed - (commodity.imported_crossfaction + commodity.imported_infaction))
			}
			commodity.shortage = needed
			stats.commodities[commodity_id] = commodity
		}
	}

	calculateProduction(criteria, stats, crossfaction_supply, infaction_supply) {
		this.calculateCommodityPool(stats, crossfaction_supply, infaction_supply)
		const infactionCap = Math.max(0, Math.floor(stats.accessibility.value() * 10) + 5)
		let availabilityChanged = false
		for (const structure in criteria.structures) {
			const config = criteria.structures[structure]
			if (!("products" in INDUSTRIES[structure])) {
				continue
			}

			const struct_prod = INDUSTRIES[structure].products(this, stats, config, criteria.market.industrial_planning)
			for (const commodity in struct_prod) {
				const produced = struct_prod[commodity]
				if (produced > (stats.products[commodity] ?? 0)) {
					stats.products[commodity] = produced
					availabilityChanged = true
				}
				const exportable = Math.min(produced, infactionCap)
				if (exportable > (infaction_supply[commodity] ?? 0)) {
					infaction_supply[commodity] = exportable
					availabilityChanged = true
				}
			}
		}
		return availabilityChanged
	}

	calculateStats(criteria, stats, spoilerLevel) {
		if (criteria.market.free_port) {
			stats.stability.add(-3, "Free port")
			stats.growth += 10
		}
		if ((spoilerLevel === 0 && this.domainRelayDiscovered) || (spoilerLevel > 0 && this.domainRelay)) {
			stats.stability.add(2, "Comm relay")
		} else {
			stats.stability.add(1, "Makeshift comm relay")
		}
		stats.fleet_size.add(0.5 + 0.25 * nonneg(this.size - 3), "Colony size")
		stats.fleet_size.mul(1 + 0.125 * (fleetSizeDoctrine - 1), "Fleet doctrine")
		stats.ship_quality.add(0.125 * (fleetQualityDoctrine - 1), "Fleet doctrine")
		// TODO: What about size 1 and 2?
		stats.ground_forces.add(
			this.size === 3 ? 50 : 100 * nonneg(this.size - 3),
			`Base value for a size ${this.size} colony`,
		)
		if (criteria.market.hypercognition) {
			stats.fleet_size.add(0.2, "Hypercognition")
			stats.ground_forces.mul(1.5, "Hypercognition")
			stats.stability.add(1, "Hypercognition")
		}
		for (const structure in criteria.structures) {
			this.applyStructureEffects(stats, structure, criteria.structures[structure], "late")
		}
		const industryCount = Object.keys(criteria.structures).reduce((c, s) => c + INDUSTRIES[s].isIndustry * 1, 0)
		const maxIndustries = this.size - 2 + stats.tap_industry
		if (industryCount > maxIndustries) {
			stats.stability.add(-5, "Maximum number of industries exceeded")
		}
		if (stats.commodities.ships.shortage) {
			const shipsProportion = 1 - stats.commodities.ships.shortage / stats.demands.ships
			stats.fleet_size.mul(shipsProportion, "Ship hulls & weapons shortage")
		}
		if (!stats.commodities.ships.available_infaction) {
			stats.ship_quality.add(-0.25, "Cross-faction imports")
		}
		const clampedStability = Math.min(Math.max(stats.stability.value(), 0), 10)
		stats.fleet_size.mul(0.75 + 0.05 * clampedStability, "Stability")
		stats.ship_quality.add(-0.25 + 0.05 * clampedStability, "Stability")
		stats.ground_forces.mul(0.25 + 0.075 * clampedStability, "Stability")
		if (clampedStability < 5) {
			stats.income.mul(clampedStability / 5, "Stability")
		}
	}

	calculateProfit(criteria, stats, economy) {
		let totalDemanded = 0
		let infactionProduced = 0
		for (const commodity in stats.demands) {
			totalDemanded += stats.demands[commodity]
			if (stats.commodities[commodity].available_infaction >= stats.demands[commodity]) {
				infactionProduced += Math.min(
					stats.commodities[commodity].available_infaction,
					stats.demands[commodity],
				)
			} else if (stats.products[commodity]) {
				infactionProduced += Math.min(stats.products[commodity], stats.demands[commodity])
			}
		}
		const infactionProportion = infactionProduced / totalDemanded
		const infactionCostMod = 1 - Math.round((100 * infactionProportion) / 2) / 100
		// Calculate total income and upkeep
		stats.income.add(nonneg(this.size - 2) * 10000, "Local income")
		for (const commodity in stats.products) {
			if ((commodity === "drugs" || commodity === "organs") && !criteria.market.free_port) {
				continue
			}
			if (commodity === "crew" || commodity === "marines") {
				continue
			}
			// This was never used in the original
			// const access_rounded = Math.round(100 * stats.accessibility.value()) / 100
			const income = estimateIncome(commodity, criteria.new_colony_id, economy)
			stats.income.add(income, COMMODITIES[commodity].name)
		}
		for (const structure in criteria.structures) {
			const config = criteria.structures[structure]
			const aicore_mod = config.aicore >= 2 ? 0.75 : 1
			stats.upkeep.add(INDUSTRIES[structure].upkeep(this, stats, config) * aicore_mod, INDUSTRIES[structure].name)
		}
		stats.upkeep.mul(stats.hazardRating.value(), "Hazard rating")
		if (infactionCostMod === 1) {
			stats.upkeep.mul(infactionCostMod, "All demand supplied out-of-faction; no upkeep reduction")
		} else {
			stats.upkeep.mul(
				infactionCostMod,
				`Demand supplied in-faction (${(100 * infactionProportion).toFixed(0)}%)`,
			)
		}
		stats.profit.add(stats.income.value(), "Income")
		stats.profit.add(-stats.upkeep.value(), "Upkeep")
	}
}

function estimateIncome(commodity, newColonyId, economy) {
	const marketShare = economy.search_shares[commodity][newColonyId]
	const globalMarketValue = COMMODITIES[commodity]?.value * economy.total_demand[commodity]
	return marketShare * globalMarketValue
}
