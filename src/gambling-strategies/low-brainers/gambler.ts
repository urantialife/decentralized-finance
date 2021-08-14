import { BinanceConnector } from "../../binance/binance-connector"
import { Player } from "../utilities/player"
import { IPortfolio, PortfolioProvider } from "../utilities/portfolio-provider"

export class Gambler {

    private portfolio: IPortfolio[] = []
    private binanceConnector: BinanceConnector
    private portfolioProvider: PortfolioProvider
    private liquidityRatioToBuy: number
    private liquidityRatioToSell: number
    private reinvestAt: number
    private investmentAmount: number
    private intervalCounter: number
    private currentPrices: any[] = []
    private mode: string = 'investWisely'
    private accountData: any
    private couldBuyWouldBuyFactor = 0.09
    private marginRatio = 0
    private historicPortfolioPrices: any[] = []
    private historicPricesLength = 45000
    private cPP = 0
    private averageCPP = 0
    private deltaToAverageInPercent = 0
    private defaultMode = ''

    public constructor(lrToBuy: number, lrToSell: number, reinvestAt: number, investmentAmount: number, binanceApiKey: string, binanceApiSecret: string, defaultMode: string) {
        this.liquidityRatioToBuy = lrToBuy
        this.liquidityRatioToSell = lrToSell
        this.binanceConnector = new BinanceConnector(binanceApiKey, binanceApiSecret)
        this.portfolioProvider = new PortfolioProvider()
        this.portfolio = this.portfolioProvider.getPortfolio()
        this.reinvestAt = reinvestAt
        this.investmentAmount = investmentAmount
        this.intervalCounter = 0
        this.defaultMode = defaultMode
    }

    public static gamble(lrToBuy: number, lrToSell: number, reinvestAt: number, investmentAmount: number, binanceApiKey: string, binanceApiSecret: string, defaultMode: string = 'investWisely'): void {

        const i = new Gambler(lrToBuy, lrToSell, reinvestAt, investmentAmount, binanceApiKey, binanceApiSecret, defaultMode)
        if (lrToBuy < 0.6 || lrToSell > 0.4 || (binanceApiKey === undefined) || binanceApiSecret === undefined) {
            throw new Error(`Strange Parameters`)
        }

        console.log(`The gambler gambles in default mode: ${defaultMode}`)

        setInterval(async () => {
            i.intervalCounter++
            console.log(`\n******************************* interval ${i.intervalCounter} *******************************`)

            try {

                await i.enjoyIt()

            } catch (error) {
                console.log(`you can improve something: ${error.message}`)
            }

        }, 9 * 1000)

    }

    private async enjoyIt() {
        this.accountData = await this.binanceConnector.getFuturesAccountData()
        this.currentPrices = await this.binanceConnector.getCurrentPrices()
        this.marginRatio = Number(this.accountData.totalMaintMargin) * 100 / Number(this.accountData.totalMarginBalance)
        this.cPP = this.portfolioProvider.getCurrentPortfolioAveragePrice(this.currentPrices)
        this.averageCPP = this.getTheAverage(this.historicPortfolioPrices)

        this.deltaToAverageInPercent = (this.cPP * 100 / this.averageCPP) - 100

        this.addToPriceHistory()
        this.determineMode()

        // console.log(JSON.stringify(hedgePosition))


        if (this.mode === 'investWisely') {

            await this.investWisely()

        } else if (this.mode === 'short') {

            await this.rattleDown()
            
        } else if (this.mode === 'long') {
            
            await this.boostUp()

        }

        if (Number(this.accountData.availableBalance) > this.investmentAmount) {

            console.log(`I can transfer some gains to the fiat and spot account as the available amount is higher than ${this.investmentAmount}`)
            await this.binanceConnector.transferFromUSDTFuturesToSpotAccount(Number(this.accountData.availableBalance) - this.investmentAmount)

        }


    }


    private async boostUp() {
        const hedgePosition = this.accountData.positions.filter((entry: any) => entry.symbol === 'DOGEUSDT')[0]

        let maximumHedgeMargin = this.getInitialMarginOfAllLongPositionsAccumulated(this.accountData) / 3
        let minimumimumHedgeMargin = maximumHedgeMargin / 3 // todo: based on deltaToAverageInPercent

        console.log(`aha: ${this.marginRatio}`)

        console.log(`maximumHedgeMargin: ${maximumHedgeMargin} vs. hedgePosition.initialMargin: ${hedgePosition.initialMargin}`)

        if (Number(hedgePosition.initialMargin) >= maximumHedgeMargin) {
            console.log(`hedgeposition is strong enough`)
        } else {
            console.log(`short selling doge as hedgeposition`)
            const r = await this.binanceConnector.sellFuture('DOGEUSDT', 1000)
            console.log(r)
        }

        if (this.marginRatio < 18 || (this.marginRatio > 27 && this.marginRatio < 36)) { // using momentum + buy low / sell high

            // await this.buy(this.currentPrices, this.accountData, this.couldBuyWouldBuyFactor)
            const currentBitcoinPrice = this.currentPrices.filter((e: any) => e.coinSymbol === 'BTCUSDT')[0].price
            const bitcoinPosition = this.accountData.positions.filter((entry: any) => entry.symbol === 'BTCUSDT')[0]
    
            const maxNotionalInBitcoin = Number((Number(bitcoinPosition.maxNotional) / currentBitcoinPrice).toFixed(0))
            const howMuchShallIBuy = Number((((Number(this.accountData.availableBalance) / currentBitcoinPrice) * Number(bitcoinPosition.leverage)) / 9).toFixed(3))
            console.log(`howMuchShallIBuy: ${howMuchShallIBuy} - maxNotionalInBitcoin: ${maxNotionalInBitcoin}`)
    
            if (maxNotionalInBitcoin > Number(bitcoinPosition.positionAmt) + howMuchShallIBuy) {
                await this.binanceConnector.buyFuture('BTCUSDT', howMuchShallIBuy - 0.001)
            }else {
                await this.binanceConnector.buyFuture('BTCUSDT', 0.001)
            }

        } else if (this.marginRatio > 63) {

            console.log(`things went south`)

            await this.sellAllPositions()
            this.defaultMode = 'investWisely'

        } else if (this.marginRatio > 54) {

            if (this.deltaToAverageInPercent < 0) {
                console.log(`take some profits from the hedge position - being below the average`)
                await this.binanceConnector.buyFuture('DOGEUSDT', Number((Number(hedgePosition.positionAmt) / 9).toFixed(3)) * -1)
            } else if (Number(hedgePosition.initialMargin) > minimumimumHedgeMargin) {
                console.log(`take some profits from the hedge position - being above the average`)
                await this.binanceConnector.buyFuture('DOGEUSDT', Number((Number(hedgePosition.positionAmt) / 9).toFixed(3)) * -1)
            } else {
                console.log(`we shall keep some of the hedge as we are above average`)
            }
        } else {
            console.log(`ready for some action`)
        }

    }

    private async rattleDown() {
        const currentBitcoinPrice = this.currentPrices.filter((e: any) => e.coinSymbol === 'BTCUSDT')[0].price
        const bitcoinPosition = this.accountData.positions.filter((entry: any) => entry.symbol === 'BTCUSDT')[0]

        const maxNotionalInBitcoin = Number((Number(bitcoinPosition.maxNotional) / currentBitcoinPrice).toFixed(0))
        const howMuchShallIShortSell = Number((((Number(this.accountData.availableBalance) / currentBitcoinPrice) * Number(bitcoinPosition.leverage)) / 9).toFixed(3))
        console.log(`howMuchShallIShortSell: ${howMuchShallIShortSell} - maxNotionalInBitcoin: ${maxNotionalInBitcoin}`)

        if (this.marginRatio < 36) {


            if (maxNotionalInBitcoin > Number(bitcoinPosition.positionAmt) * -1 + howMuchShallIShortSell) {
                await this.binanceConnector.sellFuture('BTCUSDT', howMuchShallIShortSell)
            } else if (maxNotionalInBitcoin > Number(bitcoinPosition.positionAmt) * -1 + 0.002) {
                await this.binanceConnector.sellFuture('BTCUSDT', 0.001)
            }

        } else if (this.marginRatio > 63) {

            await this.sellAllPositions()
            this.defaultMode = 'investWisely'

        }

    }

    private getInitialMarginOfAllLongPositionsAccumulated(accountData: any): number {

        let sum = 0
        for (const position of accountData.positions) {
            if (Number(position.positionAmt) > 0) {
                // console.log(position.initialMargin)
                sum = sum + Number(position.initialMargin)
            }
        }

        return sum

    }

    private addToPriceHistory() {
        if (this.historicPortfolioPrices.length === this.historicPricesLength) {
            this.historicPortfolioPrices.splice(this.historicPortfolioPrices.length - 1, 1)
        }
        this.historicPortfolioPrices.unshift(this.cPP)

    }

    private determineMode() {
        const lowestSinceX = this.getIsLowestPriceSinceX(this.cPP, this.historicPortfolioPrices)
        const highestSinceX = this.getIsHighestPriceSinceX(this.cPP, this.historicPortfolioPrices)

        const bitcoinPosition = this.accountData.positions.filter((entry: any) => entry.symbol === 'BTCUSDT')[0]
        const pnlFromBitcoinPosition = Number(bitcoinPosition.unrealizedProfit)
        const pnlFromBitcoinPositionInPercent = (pnlFromBitcoinPosition * 100 / Number(bitcoinPosition.initialMargin))

        console.log(`determining mode - cPP: ${this.cPP} - averageCPP: ${this.averageCPP} - lowestSinceX: ${lowestSinceX} - highestSinceX: ${highestSinceX} - pnlFromBitcoinPositionInPercent: ${pnlFromBitcoinPositionInPercent}`)

        if (highestSinceX > 1827 * 9 && this.deltaToAverageInPercent < -9) {
            this.mode = 'long'
        } else if (lowestSinceX > 1827 * 9 && this.deltaToAverageInPercent > 9) {
            this.mode = 'short'
        } else {
            console.log(`choosing the default mode which is ${this.defaultMode}`)
            this.mode = this.defaultMode
        }


        console.log(`mode: ${this.mode} - couldBuyWouldByFactor: ${this.couldBuyWouldBuyFactor} deltaToAverageInPercent: ${this.deltaToAverageInPercent}`)
    }

    private async investWisely(): Promise<void> {

        const liquidityRatio = Number(this.accountData.availableBalance) / Number(this.accountData.totalWalletBalance)
        const lowestPrice10_5000 = this.portfolioProvider.getLowestPriceOfRecentXIntervals(10, 5000)
        const lowestPrice300000_400000 = this.portfolioProvider.getLowestPriceOfRecentXIntervals(300000, 400000) // about 50 days
        const highestPrice10_30 = this.portfolioProvider.getHighestPriceOfRecentXIntervals(10, 30)
        const usdtBalanceOnSpot = Number(await this.binanceConnector.getUSDTBalance())

        if (this.intervalCounter === 2) {
            // await this.adjustLeverageEffect(this.accountData)
        }

        console.log(`LR: ${liquidityRatio.toFixed(2)}; CPP: ${this.cPP.toFixed(2)}; lP10_5000: ${lowestPrice10_5000.toFixed(2)}; nyrPNL: ${this.accountData.totalUnrealizedProfit}`)

        if (Number(this.accountData.totalWalletBalance) <= this.reinvestAt && usdtBalanceOnSpot > 10) {

            console.log(`I transfer USDT from Spot Account to Futures Account e.g. after a serious drop which resulted in a low wallet ballance.`)
            await this.transferUSDTFromSpotAccountToFuturesAccount(this.investmentAmount)

        } else if (this.shouldISellSomethingDueToSignificantGains(Number(this.accountData.totalUnrealizedProfit), Number(this.accountData.totalWalletBalance))) {

            console.log(`Saving something as I made some significant gains and the market seems a bit overhyped atm.`)
            console.log(`${this.accountData.totalUnrealizedProfit} vs. ${this.accountData.totalWalletBalance}`)
            await this.sell(0.07)
            await this.saveSomething(this.accountData)

        } else if (liquidityRatio <= this.liquidityRatioToSell) {

            await this.sell(0.07)

        } else if (Number(this.accountData.totalWalletBalance) > (this.reinvestAt * 3)) {

            await this.saveSomething(this.accountData)

        } else if (liquidityRatio >= this.liquidityRatioToBuy) {

            if (this.intervalCounter > 10) {
                if (this.cPP === lowestPrice10_5000) {
                    await this.buy(this.currentPrices, this.accountData, this.couldBuyWouldBuyFactor)
                    console.log(`I bought with factor ${this.couldBuyWouldBuyFactor}`)
                    await this.saveSomething(this.accountData)
                } else {
                    console.log(`I'll invest some more as soon as I hit the lowest relative price. `)
                }
            } else {
                console.log(`intervalCounter: ${this.intervalCounter}`)
            }

        } else if ((Number(this.accountData.totalUnrealizedProfit)) < ((Number(this.accountData.totalWalletBalance) * -1) / 2)) {

            console.log(`unfortunately it seems time to realize some losses. I'm selling 10 Percent of my assets.`)
            await this.sell(0.07)

        } else if (this.cPP === lowestPrice300000_400000 && this.intervalCounter > 400000) {

            console.log(`I transfer USDT from Spot Account to Futures Account due to reaching a long term low.`)
            await this.transferUSDTFromSpotAccountToFuturesAccount(this.investmentAmount * 0.5)

        } else {

            const totalGamblingValue = Number(this.accountData.totalWalletBalance) + usdtBalanceOnSpot + Number(this.accountData.totalUnrealizedProfit)

            console.log(`I'm reasonably invested. LR: ${liquidityRatio}; TGV: ${totalGamblingValue}`)

        }

    }


    public getTheAverage(list: number[]): number {

        let sum = 0
        for (const e of list) {
            sum = sum + Number(e)
        }

        return sum / list.length
    }

    private shouldISellSomethingDueToSignificantGains(totalUnrealizedProfit: number, totalWalletBalance: number): boolean {
        const randomNumberBetween7And40 = Math.floor((Math.random() * (40 - 7 + 1) + 7)) // empirical observations suggest this strangely looking approach
        const randomFactor = randomNumberBetween7And40 / 10

        console.log(`randomFactor: ${randomFactor}`)
        if (totalUnrealizedProfit > totalWalletBalance * randomFactor) {
            return true
        }

        return false
    }

    private async adjustLeverageEffect(accountData: any): Promise<void> {

        const leverageEntries = await this.binanceConnector.futuresLeverageBracket()

        for (const p of accountData.positions) {
            if (p.positionAmt > 0) {

                const leverageInfo = leverageEntries.filter((e: any) => e.symbol == p.symbol)[0]
                if (leverageInfo !== undefined) {
                    console.log(p.symbol)

                    let maxLeverageForPosition = leverageEntries.filter((e: any) => e.symbol === p.symbol)[0].brackets[0].initialLeverage
                    console.log(`adjusting leverage of ${p.symbol} to ${maxLeverageForPosition}`)
                    await this.binanceConnector.futuresLeverage(p.symbol, maxLeverageForPosition)
                } else {
                    console.log(p.symbol)
                }
            }
        }
    }

    private async saveSomething(accountData: any, savingsFactor: number = 0.05): Promise<void> {
        const savingsAmount = Number((accountData.availableBalance * savingsFactor).toFixed(0))
        console.log(`saveSomething - savingsAmount: ${savingsAmount}`)
        if (savingsAmount >= 1) {
            console.log(`I'll transfer ${savingsAmount} USDT to my fiat and spot account to prepare for a reinvestment after a serious drop.`)
            try {
                await this.binanceConnector.transferFromUSDTFuturesToSpotAccount(savingsAmount)
            } catch (error) {
                console.log(`error from transferFromUSDTFuturesToSpotAccount: ${error.message}`)
            }
        }
    }

    private async transferUSDTFromSpotAccountToFuturesAccount(investmentAmount: number): Promise<void> {

        try {
            const availableUSDTBalanceInSpotAccount = Number(await this.binanceConnector.getUSDTBalance())
            const transferAmount = (availableUSDTBalanceInSpotAccount < investmentAmount) ? availableUSDTBalanceInSpotAccount : investmentAmount

            await this.binanceConnector.transferFromSpotAccountToUSDTFutures(transferAmount)
        } catch (error) {
            console.log(`you might take a look into this: ${error.message}`)
        }

    }

    private async buy(currentPrices: any[], accountData: any, couldBuyWouldBuyFactor: number): Promise<void> {

        try {
            for (const listEntry of this.portfolio) {
                const currentPrice = currentPrices.filter((e: any) => e.coinSymbol === listEntry.pairName)[0].price
                const xPosition = accountData.positions.filter((entry: any) => entry.symbol === listEntry.pairName)[0]
                const canBuy = ((accountData.availableBalance * xPosition.leverage) / currentPrice) * (listEntry.percentage / 100)
                const howMuchToBuy = Number((canBuy * couldBuyWouldBuyFactor))
                console.log(`I'll buy ${howMuchToBuy} ${listEntry.pairName} as it has a portfolio percentage of ${listEntry.percentage}`)
                await this.binanceConnector.buyFuture(listEntry.pairName, Number(howMuchToBuy.toFixed(this.portfolioProvider.getDecimalPlaces(listEntry.pairName))))
            }

            Player.playMP3(`${__dirname}/../../sounds/game-new-level.mp3`) // https://www.freesoundslibrary.com/cow-moo-sounds/ 

        } catch (error) {
            console.log(`shit happened: ${error.message}`)
        }

    }

    private async sell(positionSellFactor: number = 0.3): Promise<void> {
        try {
            await this.binanceConnector.getFuturesAccountData()
            for (const position of this.accountData.positions) {
                if (position.positionAmt > 0 && position.symbol !== 'DOGEUSDT') { // the hedge is handled separately
                    const howMuchToSell = Number((position.positionAmt * positionSellFactor).toFixed(this.portfolioProvider.getDecimalPlaces(position.symbol)))
                    console.log(`I'll sell ${howMuchToSell} ${position.symbol}`)
                    await this.binanceConnector.sellFuture(position.symbol, howMuchToSell)
                }
            }

            Player.playMP3(`${__dirname}/../../sounds/cow-moo-sound.mp3`) // https://www.freesoundslibrary.com/cow-moo-sounds/ 

        } catch (error) {
            console.log(`shit happened: ${error.message}`)
        }
    }

    private getIsLowestPriceSinceX(price: number, arrayOfPrices: number[]) {
        let counter = 0

        for (const e of arrayOfPrices) {
            if (price > e) {
                return counter
            }
            counter++
        }
        return counter
    }

    private getIsHighestPriceSinceX(price: number, arrayOfPrices: number[]) {
        let counter = 0

        for (const e of arrayOfPrices) {
            if (price < e) {
                return counter
            }
            counter++
        }
        return counter
    }

    private async sellAllLongPositions() {
        for (let position of this.accountData.positions) {
            if (position.positionAmt > 0) {
                console.log(`selling ${position.symbol}`)
                await this.binanceConnector.sellFuture(position.symbol, Number(position.positionAmt))
            }
        }
    }

    private async sellAllShortPositions() {
        for (let position of this.accountData.positions) {
            if (position.positionAmt < 0) {
                console.log(`buying ${position.symbol}`)
                await this.binanceConnector.buyFuture(position.symbol, Number(position.positionAmt) * -1)
            }
        }
    }

    private async sellAllPositions() {
        await this.sellAllLongPositions()
        await this.sellAllShortPositions()

    }
    // private determineMode(accountData: any, currentPrices: any[]): void {
    //     console.log(`\n\n*******isBeastModeTime**********\n`)

    //     const currentdogeInBTCPrice: number = currentPrices.filter((e: any) => e.coinSymbol === 'DOGEBTC')[0].price
    //     const averageDogeInBTCPrice = this.getTheAverage(this.historicDogeInBTCPrices)
    //     const deltaDogePrice = (currentdogeInBTCPrice * 100 / averageDogeInBTCPrice) - 100
    //     // if (deltaDogePrice > 3 )

    //     // const btcCandles = await this.binanceConnector.candlesticks('BTCUSDT', '1m')

    //     // console.log(`currentBitcoinPrice: ${currentBitcoinPrice} - \nhist: ${JSON.stringify(this.historicBitcoinPrices)}`)

    //     const nextLowestBitcoinBait = Math.floor(this.currentBitcoinPrice / 1000) * 1000
    //     const nextHighestBitcoinBait = Math.ceil(this.currentBitcoinPrice / 1000) * 1000
    //     const averageBTCPrice = this.getTheAverage(this.historicBitcoinPrices)

    //     const deltaToAverageInPercent = (this.currentBitcoinPrice * 100 / averageBTCPrice) - 100

    //     console.log(`currentBitcoinPrice: ${this.currentBitcoinPrice} - deltaToAverageInPercent: ${deltaToAverageInPercent} - averageBTCPrice: ${averageBTCPrice} - currentBTCPrice: ${this.currentBitcoinPrice} - nextLowestBitcoinBait: ${nextLowestBitcoinBait} - nextHighestBitcoinBait: ${nextHighestBitcoinBait} `)

    //     console.log(`magic: ${this.currentBitcoinPrice - nextLowestBitcoinBait}`)

    //     const deltaTo10IntervalsAgoInPercent = (this.currentBitcoinPrice * 100 / this.historicBitcoinPrices[10]) - 100


    //     if (this.historicBitcoinPrices[10] === undefined) {

    //         console.log("I'm not yet ready for the fancy shit to happen")

    //     } else {

    //         if ((this.currentBitcoinPrice - nextLowestBitcoinBait) < 500 && deltaToAverageInPercent > 0 && this.getIsLowestPriceSinceX(this.currentBitcoinPrice, this.historicBitcoinPrices) > 27) {
    //             console.log("I will go short because \n1. There is a significant downtrend \n2. The Bitcoin Price is far above average \n3. It's the lowest price in 1000 intervals... \n4. The close stop loss bait might be exploited")

    //             this.mode = 'extremelyShort'

    //         } else if (this.getIsHighestPriceSinceX(this.currentBitcoinPrice, this.historicBitcoinPrices) > 27 && (this.currentBitcoinPrice - nextLowestBitcoinBait) > 500 && deltaToAverageInPercent < -0.1) {
    //             console.log("I will go long because \n1. There is a significant uptrend \n2. The Bitcoin Price is far below average \n3. It's the highest price since 1000 intervals... \n4. The close take profit bait might be exploited")

    //             this.mode = 'extremelyLong'
    //         } else {
    //             this.mode = 'standard'
    //         }


    //     }

    //     console.log(`The mode is ${this.mode}`)
    // }
}
